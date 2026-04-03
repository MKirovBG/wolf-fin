// Wolf-Fin — Telegram Bot adapter
// Sends alerts, trade proposals with inline approve/reject buttons,
// polls for callback queries, and executes approved trades via MT5 bridge.

import pino from 'pino'
import { dbGetSetting, dbSetSetting } from '../db/index.js'
import { MT5Adapter } from './mt5.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// ── Config helpers ────────────────────────────────────────────────────────────

export function getTelegramConfig(): { botToken: string | null; chatId: string | null; enabled: boolean } {
  const botToken = dbGetSetting('telegram_bot_token')
  const chatId   = dbGetSetting('telegram_chat_id')
  const enabled  = dbGetSetting('telegram_enabled') === '1'
  return { botToken, chatId, enabled }
}

export function setTelegramConfig(cfg: { botToken?: string; chatId?: string; enabled?: boolean }): void {
  if (cfg.botToken !== undefined) dbSetSetting('telegram_bot_token', cfg.botToken)
  if (cfg.chatId  !== undefined) dbSetSetting('telegram_chat_id', cfg.chatId)
  if (cfg.enabled !== undefined) dbSetSetting('telegram_enabled', cfg.enabled ? '1' : '0')
}

// ── Core send ─────────────────────────────────────────────────────────────────

async function telegramAPI(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { botToken } = getTelegramConfig()
  if (!botToken) return { ok: false, description: 'No bot token configured' }

  const url = `https://api.telegram.org/bot${botToken}/${method}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json() as Record<string, unknown>
  } catch (err) {
    log.error({ err: String(err) }, 'Telegram API call failed')
    return { ok: false, description: String(err) }
  }
}

export async function sendTelegramMessage(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<boolean> {
  const { chatId, enabled } = getTelegramConfig()
  if (!enabled || !chatId) return false

  const result = await telegramAPI('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  })

  if (!result.ok) {
    log.warn({ desc: result.description }, 'Telegram sendMessage failed')
  }
  return !!result.ok
}

async function sendTelegramMessageWithButtons(
  text: string,
  buttons: Array<{ text: string; callback_data: string }>,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
): Promise<boolean> {
  const { chatId, enabled } = getTelegramConfig()
  if (!enabled || !chatId) return false

  const result = await telegramAPI('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [buttons],
    },
  })

  if (!result.ok) {
    log.warn({ desc: result.description }, 'Telegram sendMessage with buttons failed')
  }
  return !!result.ok
}

// ── Test connection ───────────────────────────────────────────────────────────

export async function testTelegramConnection(): Promise<{ ok: boolean; botName?: string; error?: string }> {
  const { botToken } = getTelegramConfig()
  if (!botToken) return { ok: false, error: 'No bot token configured' }

  const result = await telegramAPI('getMe', {})
  if (result.ok) {
    const data = result as unknown as { ok: boolean; result: { first_name: string; username: string } }
    return { ok: true, botName: `@${data.result.username}` }
  }
  return { ok: false, error: (result.description as string) ?? 'Unknown error' }
}

// ── Pending trade proposals (in-memory, TTL-based) ───────────────────────────

interface PendingTrade {
  symbolKey: string
  symbol: string
  mt5AccountId?: number
  direction: 'BUY' | 'SELL'
  entryLow: number
  entryHigh: number
  stopLoss: number
  takeProfits: number[]
  volume: number         // lot size from position sizing
  expiresAt: number      // Unix ms
}

const pendingTrades = new Map<string, PendingTrade>()
const PENDING_TTL_MS = 15 * 60 * 1000  // 15 minutes

function generateTradeId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function purgePending(): void {
  const now = Date.now()
  for (const [id, trade] of pendingTrades) {
    if (now > trade.expiresAt) pendingTrades.delete(id)
  }
}

// ── Formatted alert messages ──────────────────────────────────────────────────

export async function sendAlertNotification(symbolKey: string, ruleName: string, message: string): Promise<void> {
  const text = [
    `🔔 <b>Alert: ${ruleName}</b>`,
    `📊 <b>${symbolKey}</b>`,
    ``,
    message,
    ``,
    `<i>${new Date().toUTCString()}</i>`,
  ].join('\n')

  await sendTelegramMessage(text)
}

export async function sendTradeProposal(
  symbolKey: string,
  direction: string,
  entryLow: number,
  entryHigh: number,
  stopLoss: number,
  takeProfits: number[],
  riskReward: number,
  confidence: string,
  reasoning: string,
  volume?: number,
  accountBalance?: number,
): Promise<void> {
  const emoji = direction === 'BUY' ? '🟢' : '🔴'
  const confEmoji = confidence === 'high' ? '🟢' : confidence === 'medium' ? '🟡' : '🔴'

  // Parse symbolKey: "mt5:SYMBOL:ACCOUNT_ID"
  const parts = symbolKey.split(':')
  const symbol = parts[1] || symbolKey
  const mt5AccountId = parts[2] ? parseInt(parts[2]) : undefined

  const lotSize = volume ?? 0.01

  // Store pending trade
  const tradeId = generateTradeId()
  pendingTrades.set(tradeId, {
    symbolKey,
    symbol,
    mt5AccountId,
    direction: direction as 'BUY' | 'SELL',
    entryLow,
    entryHigh,
    stopLoss,
    takeProfits,
    volume: lotSize,
    expiresAt: Date.now() + PENDING_TTL_MS,
  })

  const entryMid = (entryLow + entryHigh) / 2
  const tpLines = takeProfits.map((tp, i) => {
    const tpRR = Math.abs(tp - entryMid) / Math.abs(entryMid - stopLoss)
    return `   ├─ TP${i + 1}: <code>${tp}</code>  (${tpRR.toFixed(1)}R)`
  })
  // Replace last ├─ with └─
  if (tpLines.length > 0) {
    tpLines[tpLines.length - 1] = tpLines[tpLines.length - 1].replace('├─', '└─')
  }

  const riskAmt = accountBalance ? (accountBalance * 0.01) : null
  const riskLine = riskAmt
    ? `   Risk: <code>$${riskAmt.toFixed(2)}</code> (1% of $${accountBalance!.toFixed(0)})`
    : ''

  const text = [
    `${emoji} <b>TRADE PROPOSAL</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `<b>${direction} ${symbol}</b>`,
    ``,
    `┌─ <b>Entry Zone</b>`,
    `│  <code>${entryLow}</code> — <code>${entryHigh}</code>`,
    `│`,
    `├─ <b>Stop Loss:</b> <code>${stopLoss}</code>`,
    `│`,
    `├─ <b>Take Profits</b>`,
    ...tpLines,
    ``,
    `📐 <b>R:R</b> ${riskReward.toFixed(2)}  ·  ${confEmoji} <b>${confidence.toUpperCase()}</b>`,
    `📦 <b>Volume:</b> <code>${lotSize}</code> lots`,
    riskLine,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `💬 <i>${reasoning.slice(0, 280)}${reasoning.length > 280 ? '…' : ''}</i>`,
    ``,
    `⏱ ${new Date().toUTCString()}`,
    `⏳ <i>Expires in 15 min</i>`,
  ].filter(l => l !== '').join('\n')

  await sendTelegramMessageWithButtons(text, [
    { text: `✅ Place ${direction} ${lotSize} lots`, callback_data: `approve:${tradeId}` },
    { text: '❌ Skip', callback_data: `reject:${tradeId}` },
  ])
}

export async function sendAnalysisCompleted(
  symbolKey: string,
  bias: string,
  summary: string,
  hasProposal: boolean,
  strategyKey?: string,
  indicators?: Record<string, number | string>,
  timeframe?: string,
  accountBalance?: number,
  accountEquity?: number,
): Promise<void> {
  const biasEmoji = bias === 'bullish' ? '🟢' : bias === 'bearish' ? '🔴' : '⚪'
  const symbol = symbolKey.split(':')[1] || symbolKey

  // Build indicator summary line
  const indLines: string[] = []
  if (indicators) {
    if (indicators.rsi14 != null) indLines.push(`RSI: <code>${Number(indicators.rsi14).toFixed(1)}</code>`)
    if (indicators.ema20 != null && indicators.ema50 != null) {
      const emaSignal = Number(indicators.ema20) > Number(indicators.ema50) ? '▲' : '▼'
      indLines.push(`EMA: ${emaSignal}`)
    }
    if (indicators.atr14 != null) indLines.push(`ATR: <code>${Number(indicators.atr14).toFixed(2)}</code>`)
    const mtf = indicators.mtfConfluence ?? indicators['mtf.confluence']
    if (mtf != null) indLines.push(`MTF: <code>${mtf}/3</code>`)
  }

  const accountLine = accountBalance
    ? `💰 Balance: <code>$${accountBalance.toFixed(2)}</code>  ·  Equity: <code>$${(accountEquity ?? accountBalance).toFixed(2)}</code>`
    : ''

  const lines = [
    `📊 <b>ANALYSIS — ${symbol}</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    strategyKey ? `🎯 Strategy: <b>${strategyKey}</b>` : '',
    timeframe ? `🕐 Timeframe: <b>${timeframe.toUpperCase()}</b>` : '',
    ``,
    `${biasEmoji} Bias: <b>${bias.toUpperCase()}</b>`,
    ``,
    indLines.length > 0 ? `📈 ${indLines.join('  ·  ')}` : '',
    accountLine,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    summary.slice(0, 400) + (summary.length > 400 ? '…' : ''),
    ``,
    hasProposal ? '✅ <b>Trade proposal attached below</b>' : '❌ <i>No actionable trade setup found</i>',
    ``,
    `⏱ ${new Date().toUTCString()}`,
  ].filter(l => l !== '').join('\n')

  await sendTelegramMessage(lines)
}

export async function sendDigestSummary(purged: number, memories: number, symbols: string[]): Promise<void> {
  const text = [
    `📋 <b>Daily Digest Complete</b>`,
    ``,
    `• Memories created: <b>${memories}</b>`,
    `• Expired purged: <b>${purged}</b>`,
    `• Symbols: ${symbols.join(', ') || 'none'}`,
    ``,
    `<i>${new Date().toUTCString()}</i>`,
  ].join('\n')

  await sendTelegramMessage(text)
}

// ── Callback query handler (trade approval/rejection) ────────────────────────

async function handleCallbackQuery(callbackQuery: {
  id: string
  data?: string
  message?: { chat: { id: number }; message_id: number }
}): Promise<void> {
  const { id, data, message } = callbackQuery
  if (!data || !message) {
    await telegramAPI('answerCallbackQuery', { callback_query_id: id, text: 'Invalid callback' })
    return
  }

  const [action, tradeId] = data.split(':')
  purgePending()

  const trade = pendingTrades.get(tradeId)

  if (!trade) {
    await telegramAPI('answerCallbackQuery', { callback_query_id: id, text: '⏰ Trade expired or already handled' })
    // Update the original message
    await telegramAPI('editMessageReplyMarkup', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reply_markup: { inline_keyboard: [] },
    })
    return
  }

  if (action === 'reject') {
    pendingTrades.delete(tradeId)
    await telegramAPI('answerCallbackQuery', { callback_query_id: id, text: '❌ Trade skipped' })
    await telegramAPI('editMessageReplyMarkup', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reply_markup: { inline_keyboard: [] },
    })
    await sendTelegramMessage(`❌ <b>Trade skipped:</b> ${trade.direction} ${trade.symbolKey}`)
    return
  }

  if (action === 'approve') {
    pendingTrades.delete(tradeId)
    await telegramAPI('answerCallbackQuery', { callback_query_id: id, text: '⏳ Placing order...' })

    // Remove buttons immediately
    await telegramAPI('editMessageReplyMarkup', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reply_markup: { inline_keyboard: [] },
    })

    try {
      const adapter = new MT5Adapter(trade.mt5AccountId)
      const result = await adapter.placeOrder({
        symbol: trade.symbol,
        side: trade.direction,
        type: 'MARKET',
        quantity: trade.volume,
        stopPrice: trade.stopLoss,
        tpPrice: trade.takeProfits[0],  // TP1 as the MT5 TP
      })

      const statusEmoji = result.status === 'FILLED' ? '✅' : '🕐'
      await sendTelegramMessage([
        `${statusEmoji} <b>Order ${result.status}</b>`,
        ``,
        `<b>${trade.direction} ${trade.symbol}</b>`,
        `Volume: <code>${result.origQty}</code>`,
        `Price: <code>${result.price}</code>`,
        `SL: <code>${trade.stopLoss}</code>`,
        `TP1: <code>${trade.takeProfits[0]}</code>`,
        `Order #: <code>${result.orderId}</code>`,
        ``,
        `⏱ ${new Date().toUTCString()}`,
      ].join('\n'))

      log.info({
        symbol: trade.symbol,
        direction: trade.direction,
        volume: result.origQty,
        price: result.price,
        orderId: result.orderId,
      }, 'Telegram-approved trade executed')

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await sendTelegramMessage([
        `⚠️ <b>Order FAILED</b>`,
        ``,
        `<b>${trade.direction} ${trade.symbol}</b> · <code>${trade.volume}</code> lots`,
        ``,
        `Error: <code>${errMsg.slice(0, 200)}</code>`,
        ``,
        `⏱ ${new Date().toUTCString()}`,
      ].join('\n'))

      log.error({ symbol: trade.symbol, err: errMsg }, 'Telegram-approved trade failed')
    }
  }
}

// ── Polling loop for callback queries ────────────────────────────────────────

let pollingActive = false
let pollingOffset = 0

export function startTelegramPolling(): void {
  if (pollingActive) return
  const { enabled, botToken } = getTelegramConfig()
  if (!enabled || !botToken) {
    log.info('Telegram polling not started — not configured or disabled')
    return
  }

  pollingActive = true
  log.info('Telegram callback polling started')
  pollLoop()
}

export function stopTelegramPolling(): void {
  pollingActive = false
  log.info('Telegram callback polling stopped')
}

async function pollLoop(): Promise<void> {
  while (pollingActive) {
    try {
      const { enabled } = getTelegramConfig()
      if (!enabled) {
        pollingActive = false
        break
      }

      const result = await telegramAPI('getUpdates', {
        offset: pollingOffset,
        timeout: 30,             // long-polling: 30s
        allowed_updates: ['callback_query'],
      })

      if (result.ok && Array.isArray(result.result)) {
        for (const update of result.result as Array<{ update_id: number; callback_query?: unknown }>) {
          pollingOffset = update.update_id + 1
          if (update.callback_query) {
            handleCallbackQuery(update.callback_query as Parameters<typeof handleCallbackQuery>[0])
              .catch(e => log.error({ err: String(e) }, 'Callback query handler error'))
          }
        }
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Telegram polling error — retrying in 5s')
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}
