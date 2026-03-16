// Wolf-Fin Fear & Greed — Alternative.me crypto sentiment index (no API key needed)
/**
 * Fetches the latest Fear & Greed index from Alternative.me.
 * Returns null on any network/parse error so the caller can degrade gracefully.
 */
export async function fetchFearGreed() {
    try {
        const res = await fetch('https://api.alternative.me/fng/?limit=1');
        if (!res.ok)
            return null;
        const json = await res.json();
        const item = json.data?.[0];
        if (!item)
            return null;
        return {
            value: parseInt(item.value, 10),
            classification: item.value_classification,
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=feargreed.js.map