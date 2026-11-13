// SPDX-License-Identifier: MIT

interface Signal {
  label: string
  pattern: RegExp
}

/**
 * Phrases that indicate text is addressed to an AI model or tries to make one act.
 * These are only evaluated against content that is hidden from human readers, where
 * such phrasing has no legitimate reason to exist.
 */
const SIGNALS: readonly Signal[] = [
  {
    label: 'instruction override',
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\b[^\n]{0,40}?\b(?:previous|prior|above|earlier|all|any|your|the|these|those|system)\b[^\n]{0,20}?\b(?:instructions?|prompts?|rules|guidelines|directions|guardrails|policies)\b/iu
  },
  {
    label: 'role assignment',
    pattern:
      /\b(?:you are|you're|act as|pretend to be|roleplay as|behave as)\b[^\n]{0,30}?\b(?:an? )?(?:ai|assistant|agent|llm|language model|chatbot|bot|model)\b/iu
  },
  {
    label: 'prompt reference',
    pattern: /\b(?:system|developer|hidden)[\s_-]*(?:prompt|message|instructions?)\b/iu
  },
  {
    label: 'AI addressee',
    pattern:
      /\b(?:claude|copilot|gemini|chatgpt|gpt-?\d\w*|openai|anthropic|codex|devin|llm|ai[\s-](?:agent|assistant|model|reviewer|bot)|coding agent|language model|dear (?:ai|agent|assistant))\b/iu
  },
  {
    label: 'new instructions',
    pattern:
      /\b(?:new|updated|important|additional|real|actual|secret|urgent)\s+(?:instructions?|tasks?|directives?|orders?)\b/iu
  },
  {
    label: 'command execution',
    pattern:
      /\b(?:run|execute|eval|invoke|call)\b[^\n]{0,30}?\b(?:commands?|scripts?|shell|bash|sh|zsh|curl|wget|powershell|pwsh|python|node|npm|gh)\b/iu
  },
  {
    label: 'remote download',
    pattern: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n]{0,60}?https?:\/\//iu
  },
  {
    label: 'pipe to shell',
    pattern: /\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/iu
  },
  {
    label: 'secret access',
    pattern:
      /\b(?:send|post|upload|exfiltrate|print|echo|output|include|reveal|leak|cat|dump|base64|share|commit|write|copy|paste)\b[^\n]{0,60}?(?:\bsecrets?\b|\bapi[\s_-]?keys?\b|\btokens?\b|\bcredentials?\b|\bpasswords?\b|\benv(?:ironment)?\s+variables?\b|\bGITHUB_TOKEN\b|\b[A-Z][A-Z0-9]*_(?:TOKEN|KEY|SECRET)\b|\.env\b|\bssh\s+keys?\b|\bprivate\s+keys?\b|~\/\.ssh|\/etc\/passwd)/iu
  },
  {
    label: 'concealment',
    pattern:
      /\b(?:do not|don't|never|without)\s+(?:tell|telling|mention|mentioning|reveal|revealing|inform|informing|alert|alerting|notify|notifying)\b[^\n]{0,30}?\b(?:users?|humans?|maintainers?|reviewers?|anyone|them)\b/iu
  },
  {
    label: 'approval request',
    pattern: /\b(?:approve|merge|lgtm)\b[^\n]{0,20}?\b(?:this|the)\s+(?:pr|pull request|change|issue)\b/iu
  },
  {
    label: 'chat-template token',
    pattern:
      /<\|?(?:im_start|im_end|system|endoftext)\|?>|\[\/?INST\]|<\/?(?:system|instructions?|assistant|human)>|(?:^|\n)[ \t]*(?:system|assistant|human)[ \t]*:[ \t]*\S/iu
  }
]

/** Returns the labels of every injection signal found in `text`. */
export function injectionSignals(text: string): string[] {
  const labels: string[] = []
  for (const { label, pattern } of SIGNALS) {
    if (pattern.test(text)) labels.push(label)
  }
  return labels
}
