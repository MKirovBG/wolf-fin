// Wolf-Fin — Telegram Bot adapter
// Sends alerts, trade proposals, and supports future NL query interface

import pino from 'pino'
import { dbGetSetting, dbSetSetting } from '../db/index.js'

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

async function telegramAPI(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; description?: string }> {
  const { botToken } = getTelegramConfig()
  if (!botToken) return { ok: false, description: 'No bot token configured' }

  const url = `https://api.telegram.org/bot${botToken}/${method}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json() as { ok: boolean; description?: string }
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
  return result.ok
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
  return { ok: false, error: result.description ?? 'Unknown error' }
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
): Promise<void> {
  const emoji = direction === 'BUY' ? '🟢' : '🔴'
  const tpLines = takeProfits.map((tp, i) => `  TP${i + 1}: <code>${tp}</code>`).join('\n')

  const text = [
    `${emoji} <b>${direction} ${symbolKey}</b>  ·  R:R ${riskReward.toFixed(2)}  ·  ${confidence}`,
    ``,
    `<b>Entry:</b> <code>${entryLow}</code> – <code>${entryHigh}</code>`,
    `<b>Stop Loss:</b> <code>${stopLoss}</code>`,
    `<b>Take Profits:</b>`,
    tpLines,
    ``,
    `<i>${reasoning.slice(0, 200)}${reasoning.length > 200 ? '…' : ''}</i>`,
    ``,
    `⏱ ${new Date().toUTCString()}`,
  ].join('\n')

  await sendTelegramMessage(text)
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
