export interface IndicatorConfig {
    rsiEnabled?: boolean;
    rsiPeriod?: number;
    emaFast?: number;
    emaSlow?: number;
    atrPeriod?: number;
    bbPeriod?: number;
    bbStdDev?: number;
    atrEnabled?: boolean;
    emaFastEnabled?: boolean;
    emaSlowEnabled?: boolean;
    bbEnabled?: boolean;
    vwapEnabled?: boolean;
    mtfEnabled?: boolean;
    macdEnabled?: boolean;
    adxEnabled?: boolean;
    stochEnabled?: boolean;
    psarEnabled?: boolean;
    ichimokuEnabled?: boolean;
    cciEnabled?: boolean;
    williamsREnabled?: boolean;
    obvEnabled?: boolean;
    mfiEnabled?: boolean;
    keltnerEnabled?: boolean;
    divergenceEnabled?: boolean;
    fibEnabled?: boolean;
    patternsEnabled?: boolean;
}
export interface CandleConfig {
    primaryTimeframe?: 'm1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h4';
    limit?: number;
}
export interface ContextConfig {
    economicCalendar?: boolean;
    forexNews?: boolean;
}
export interface WatchSymbol {
    key: string;
    symbol: string;
    market: 'mt5';
    displayName?: string;
    mt5AccountId?: number;
    scheduleEnabled: boolean;
    scheduleIntervalMs?: number;
    scheduleStartUtc?: string;
    scheduleEndUtc?: string;
    indicatorConfig?: IndicatorConfig;
    candleConfig?: CandleConfig;
    contextConfig?: ContextConfig;
    llmProvider?: 'platform' | 'anthropic' | 'anthropic-subscription' | 'openrouter' | 'ollama' | 'openai-subscription';
    llmModel?: string;
    strategy?: string;
    systemPrompt?: string;
    createdAt: string;
    lastAnalysisAt?: string;
}
export interface KeyLevel {
    price: number;
    type: 'support' | 'resistance' | 'pivot';
    strength: 'strong' | 'moderate' | 'weak';
    label: string;
}
export interface TradeProposal {
    direction: 'BUY' | 'SELL' | null;
    entryZone: {
        low: number;
        high: number;
    };
    stopLoss: number;
    takeProfits: number[];
    riskReward: number;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low';
    invalidatedIf?: string;
}
export interface AnalysisResult {
    id: number;
    symbolKey: string;
    symbol: string;
    market: 'mt5';
    timeframe: string;
    time: string;
    bias: 'bullish' | 'bearish' | 'neutral';
    summary: string;
    keyLevels: KeyLevel[];
    tradeProposal: TradeProposal | null;
    indicators: Record<string, number | string>;
    candles: CandleBar[];
    context: AnalysisContext;
    llmProvider: string;
    llmModel: string;
    patterns?: CandlePattern[];
    validation?: ProposalValidation;
    error?: string;
    rawResponse?: string;
    llmThinking?: string;
}
export interface AnalysisContext {
    news?: Array<{
        headline: string;
        sentiment: string;
        url?: string;
    }>;
    calendar?: Array<{
        time: string;
        event: string;
        impact: string;
        country: string;
    }>;
    currentPrice?: {
        bid: number;
        ask: number;
        spread: number;
    };
    symbolInfo?: {
        point: number;
        digits: number;
        volumeMin: number;
        volumeStep: number;
    };
    session?: {
        activeSessions: string[];
        isLondonNYOverlap: boolean;
        isOptimalSession: boolean;
        note: string;
    };
}
export interface CandlePattern {
    name: string;
    direction: 'bullish' | 'bearish' | 'neutral';
    price: number;
    barIndex: number;
    description: string;
}
export interface ProposalValidation {
    score: number;
    flags: string[];
    valid: boolean;
}
export interface CandleBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogEvent = 'analysis_start' | 'analysis_end' | 'analysis_error' | 'analysis_skip' | 'schedule_start' | 'schedule_stop' | 'schedule_tick' | 'llm_request' | 'llm_response' | 'symbol_added' | 'symbol_removed' | 'features_computed';
export interface LogEntry {
    id: number;
    time: string;
    symbolKey: string;
    level: LogLevel;
    event: LogEvent;
    message: string;
    data?: Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map