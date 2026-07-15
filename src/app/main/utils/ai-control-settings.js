const DEFAULT_AI_CONTROL_MCP_CALL_LIMIT = 100;
const MIN_AI_CONTROL_MCP_CALL_LIMIT = 1;
const MAX_AI_CONTROL_MCP_CALL_LIMIT = 1000;

function normalizeAiControlMcpCallLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_AI_CONTROL_MCP_CALL_LIMIT;
  return Math.min(
    MAX_AI_CONTROL_MCP_CALL_LIMIT,
    Math.max(MIN_AI_CONTROL_MCP_CALL_LIMIT, Math.trunc(numeric)),
  );
}

function getAiControlMcpCallLimit(store = {}) {
  return normalizeAiControlMcpCallLimit(store?.aiControlSettings?.mcpCallLimit);
}

module.exports = {
  DEFAULT_AI_CONTROL_MCP_CALL_LIMIT,
  MIN_AI_CONTROL_MCP_CALL_LIMIT,
  MAX_AI_CONTROL_MCP_CALL_LIMIT,
  getAiControlMcpCallLimit,
  normalizeAiControlMcpCallLimit,
};
