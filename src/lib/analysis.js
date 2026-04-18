const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;
const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
function fileHasTestCoverage(filePath, graph) {
    const importers = graph.getImporters(filePath);
    if (importers.some(f => TEST_PATTERN.test(f)))
        return true;
    const base = filePath.replace(/\.[^.]+$/, '');
    const stem = base.split('/').pop() ?? '';
    return graph.allFiles().some(f => TEST_PATTERN.test(f) && stem.length > 0 && f.includes(stem));
}
function computeFileRiskLevel(filePath, graph) {
    const isTest = TEST_PATTERN.test(filePath);
    const importerCount = graph.getImporters(filePath).length;
    const isHub = importerCount >= 5;
    const hasCoverage = isTest || fileHasTestCoverage(filePath, graph);
    let level;
    if (isTest) {
        level = 'low';
    }
    else if (isHub && !hasCoverage) {
        level = 'critical';
    }
    else if (isHub || (!hasCoverage && importerCount > 2)) {
        level = 'high';
    }
    else if (!hasCoverage) {
        level = 'medium';
    }
    else if (importerCount > 2) {
        level = 'medium';
    }
    else {
        level = 'low';
    }
    return { level, importerCount, isHub, hasCoverage };
}
function bucketChurn(churnLines) {
    if (churnLines < 100)
        return 'low';
    if (churnLines < 500)
        return 'medium';
    return 'high';
}
function buildOverlayRisk(filePath, overlay) {
    const churnStats = overlay.churn.statsFor(filePath);
    const ownStats = overlay.ownership.statsFor(filePath);
    const coupled = overlay.coChange.topFor({ node: filePath, limit: 3 }) ?? [];
    const churn = churnStats !== null && churnStats !== undefined
        ? bucketChurn(churnStats.churnLines)
        : 'low';
    const bugDensity = churnStats?.bugDensity ?? 0;
    const coupledNodes = coupled.map(c => ({
        node: c.nodeA === filePath ? c.nodeB : c.nodeA,
        confidence: c.confidence,
    }));
    const owners = (ownStats?.owners ?? []).map(o => ({
        author: o.author,
        share: o.share,
    }));
    return { churn, bugDensity, coupledNodes, owners };
}
export function detectChanges(input) {
    const { graph, overlay, changedFiles } = input;
    const scored = changedFiles.map(file => {
        const { level, importerCount, isHub, hasCoverage } = computeFileRiskLevel(file, graph);
        const risk = overlay !== undefined ? buildOverlayRisk(file, overlay) : null;
        return {
            file,
            riskLevel: level,
            importerCount,
            isHub,
            hasTestCoverage: hasCoverage,
            risk,
        };
    });
    scored.sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel]);
    const summary = {
        critical: scored.filter(s => s.riskLevel === 'critical').length,
        high: scored.filter(s => s.riskLevel === 'high').length,
        medium: scored.filter(s => s.riskLevel === 'medium').length,
        low: scored.filter(s => s.riskLevel === 'low').length,
    };
    return { changedFiles: scored, summary };
}
function traverseImporters(changedFiles, graph, depth) {
    const changedSet = new Set(changedFiles);
    const directImporters = new Set();
    const allReachable = new Set();
    let frontier = new Set(changedFiles);
    for (let d = 0; d < depth; d++) {
        const nextFrontier = new Set();
        for (const file of frontier) {
            for (const imp of graph.getImporters(file)) {
                if (changedSet.has(imp))
                    continue;
                if (d === 0)
                    directImporters.add(imp);
                if (!allReachable.has(imp)) {
                    allReachable.add(imp);
                    nextFrontier.add(imp);
                }
            }
        }
        frontier = nextFrontier;
        if (frontier.size === 0)
            break;
    }
    return { directImporters, allReachable };
}
function buildHistoricalCouplingEntries(changedFiles, staticSet, overlay) {
    const now = Math.floor(Date.now() / 1000);
    const coupling = [];
    for (const seedFile of changedFiles) {
        const coupled = overlay.coChange.topFor({ node: seedFile, limit: 10, minConfidence: 0.2 });
        for (const hit of coupled) {
            const sibling = hit.nodeA === seedFile ? hit.nodeB : hit.nodeA;
            if (!staticSet.has(sibling) && !coupling.some(h => h.node === sibling)) {
                const daysSinceLast = Math.round((now - hit.lastSharedTimestamp) / 86400);
                coupling.push({
                    node: sibling,
                    confidence: hit.confidence,
                    evidence: `Changed together in ${hit.sharedCommits} commits; last co-change ${daysSinceLast} days ago.`,
                });
            }
        }
    }
    coupling.sort((a, b) => b.confidence - a.confidence);
    coupling.splice(10);
    return coupling;
}
export function getImpactRadius(input) {
    const { graph, overlay, changedFiles, depth = 3 } = input;
    const { directImporters, allReachable } = traverseImporters(changedFiles, graph, depth);
    const transitiveImporters = [];
    for (const file of allReachable) {
        if (!directImporters.has(file))
            transitiveImporters.push(file);
    }
    const staticSet = new Set([
        ...changedFiles,
        ...directImporters,
        ...transitiveImporters,
    ]);
    const historicalCoupling = overlay !== undefined
        ? buildHistoricalCouplingEntries(changedFiles, staticSet, overlay)
        : [];
    const totalImpacted = directImporters.size + transitiveImporters.length;
    return {
        seedFiles: [...changedFiles],
        directImporters: Array.from(directImporters),
        transitiveImporters,
        historicalCoupling,
        totalImpacted,
    };
}
//# sourceMappingURL=analysis.js.map