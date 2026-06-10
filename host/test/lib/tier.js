// Tier label for the tier-eval suite. TIER is set per-sweep by the driver
// (run-config-ab.sh) and rides into the reporter's per-test header via
// TIER_LABEL. The bridge/model routing this module used to carry was part of
// the retired claw stack (#008/#010; archived at tag `claw-stack-final`).

export const TIER       = process.env.TIER ?? '64';
export const TIER_LABEL = `tier-${TIER}`;
