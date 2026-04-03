import type { TradeProposal, KeyLevel, ProposalValidation } from '../types.js';
interface ValidateInput {
    proposal: TradeProposal;
    keyLevels: KeyLevel[];
    atr: number;
    bias: 'bullish' | 'bearish' | 'neutral';
    mtfScore?: number;
}
export declare function validateProposal(input: ValidateInput): ProposalValidation;
export {};
//# sourceMappingURL=validate.d.ts.map