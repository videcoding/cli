const agentsPlatform = {
  type: 'prompt' as const,
  name: 'agents-platform',
  description: 'Agents platform is unavailable in this source tree.',
  progressMessage: 'agents platform unavailable',
  contentLength: 0,
  source: 'builtin' as const,
  isEnabled: () => false,
  isHidden: true,
  async getPromptForCommand() {
    return [
      {
        type: 'text' as const,
        text: 'Agents platform is unavailable in this source tree.',
      },
    ]
  },
}

export default agentsPlatform
