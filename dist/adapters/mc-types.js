// Wolf-Fin — Enhanced Monte Carlo shared types
// All layers produce typed outputs that feed the orchestrator.
export const MC_ENHANCEMENT_DEFAULTS = {
    markov: false,
    agentBased: false,
    scenarios: false,
    bayesian: false,
    kelly: false,
};
export const MC_ENHANCEMENT_LABELS = {
    markov: { label: 'Markov Regime', description: 'Detects market state (trending/ranging/volatile) and adjusts path probabilities accordingly.' },
    agentBased: { label: 'Crowd Positioning', description: 'Estimates where retail stops are clustered and which direction the crowd is leaning.' },
    scenarios: { label: 'Scenario Analysis', description: 'Stress-tests the strategy under high volatility, low volatility, and pre-news conditions.' },
    bayesian: { label: 'Bayesian Confidence', description: 'Updates strategy confidence after every trade using a statistical learning model.' },
    kelly: { label: 'Kelly Criterion', description: 'Computes the mathematically optimal position size given your historical edge.' },
};
//# sourceMappingURL=mc-types.js.map