import { describe, expect, test } from 'bun:test'
import {
  CommandMetadataSchema,
  DependencyRefSchema,
  InstalledPluginsFileSchema,
  InstalledPluginsFileSchemaV1,
  InstalledPluginsFileSchemaV2,
  KnownMarketplacesFileSchema,
  KnownMarketplaceSchema,
  LspServerConfigSchema,
  MarketplaceSourceSchema,
  PluginIdSchema,
  PluginManifestSchema,
  PluginMarketplaceEntrySchema,
  PluginMarketplaceSchema,
  PluginScopeSchema,
  PluginSourceSchema,
  SettingsPluginEntrySchema,
  isBlockedOfficialName,
  isLocalMarketplaceSource,
  isLocalPluginSource,
  isMarketplaceAutoUpdate,
  validateOfficialNameSource,
} from '../../../src/utils/plugins/schemas.ts'

describe('plugin schemas', () => {
  test('protects official marketplace names and auto-update defaults', () => {
    expect(isMarketplaceAutoUpdate('claude-code-marketplace', {})).toBe(true)
    expect(isMarketplaceAutoUpdate('knowledge-work-plugins', {})).toBe(false)
    expect(
      isMarketplaceAutoUpdate('claude-code-marketplace', { autoUpdate: false }),
    ).toBe(false)

    expect(isBlockedOfficialName('claude-code-marketplace')).toBe(false)
    expect(isBlockedOfficialName('anthropic-marketplace-v2')).toBe(true)
    expect(isBlockedOfficialName('оfficial-claude')).toBe(true)
  })

  test('validates reserved marketplace names against their source', () => {
    expect(
      validateOfficialNameSource('claude-code-marketplace', {
        source: 'github',
        repo: 'anthropics/claude-code-marketplace',
      }),
    ).toBeNull()

    expect(
      validateOfficialNameSource('claude-code-marketplace', {
        source: 'git',
        url: 'git@github.com:anthropics/claude-code-marketplace.git',
      }),
    ).toBeNull()

    expect(
      validateOfficialNameSource('claude-code-marketplace', {
        source: 'github',
        repo: 'someone-else/claude-code-marketplace',
      }),
    ).toContain("reserved for official Anthropic marketplaces")

    expect(
      validateOfficialNameSource('claude-code-marketplace', {
        source: 'url',
        url: 'https://example.com/marketplace.json',
      }),
    ).toContain("can only be used with GitHub sources")
  })

  test('validates command metadata and LSP server configuration', () => {
    expect(
      CommandMetadataSchema().parse({
        source: './commands/review.md',
        description: 'Review code',
        allowedTools: ['Read', 'Edit'],
      }),
    ).toMatchObject({
      source: './commands/review.md',
      description: 'Review code',
    })

    const invalidCommand = CommandMetadataSchema().safeParse({
      source: './commands/review.md',
      content: '# duplicate',
    })
    expect(invalidCommand.success).toBe(false)
    if (invalidCommand.success) {
      throw new Error('expected command metadata validation to fail')
    }
    expect(invalidCommand.error.issues[0]?.message).toContain(
      'either "source" (file path) or "content" (inline markdown), but not both',
    )

    expect(
      LspServerConfigSchema().parse({
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: {
          '.ts': 'typescript',
          '.tsx': 'typescriptreact',
        },
        transport: 'stdio',
        startupTimeout: 5_000,
        restartOnCrash: true,
      }),
    ).toMatchObject({
      command: 'typescript-language-server',
      transport: 'stdio',
    })

    const invalidLsp = LspServerConfigSchema().safeParse({
      command: 'typescript-language-server --stdio',
      extensionToLanguage: {
        ts: 'typescript',
      },
    })
    expect(invalidLsp.success).toBe(false)
    if (invalidLsp.success) {
      throw new Error('expected lsp validation to fail')
    }
    const messages = invalidLsp.error.issues.map(issue => issue.message)
    expect(messages).toContain(
      'Command should not contain spaces. Use args array for arguments.',
    )
    expect(messages.some(message => message.includes('Invalid key in record'))).toBe(
      true,
    )
  })

  test('parses rich plugin manifests with hooks, commands, channels, MCP, LSP, and userConfig', () => {
    const manifest = PluginManifestSchema().parse({
      name: 'review-helper',
      version: '1.2.3',
      description: 'Adds review helpers',
      author: { name: 'Example Co' },
      homepage: 'https://example.com/plugin',
      repository: 'https://github.com/example/review-helper',
      keywords: ['review', 'quality'],
      dependencies: ['formatter@tools@^1.0.0', { name: 'reader' }],
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [{ type: 'command', command: 'echo done' }],
          },
        ],
      },
      commands: {
        review: {
          content: '# Review',
          description: 'Review the current diff',
          model: 'claude-sonnet-4-6',
        },
      },
      agents: ['./agents/reviewer.md'],
      skills: ['./skills/reviewer'],
      outputStyles: ['./output-styles/reviewer.json'],
      channels: [
        {
          server: 'review-channel',
          displayName: 'Review Channel',
          userConfig: {
            API_TOKEN: {
              type: 'string',
              title: 'API token',
              description: 'Token for the review bot',
              sensitive: true,
            },
          },
        },
      ],
      mcpServers: {
        'review-channel': {
          type: 'stdio',
          command: 'node',
          args: ['./server.js'],
          env: { API_TOKEN: '${user_config.API_TOKEN}' },
        },
      },
      lspServers: {
        tsserver: {
          command: 'typescript-language-server',
          args: ['--stdio'],
          extensionToLanguage: { '.ts': 'typescript' },
        },
      },
      settings: {
        agent: 'reviewer',
      },
      userConfig: {
        REVIEW_MODE: {
          type: 'string',
          title: 'Review mode',
          description: 'How strict reviews should be',
          default: 'standard',
        },
      },
    })

    expect(manifest.dependencies).toEqual(['formatter@tools', 'reader'])
    expect(manifest.commands).toMatchObject({
      review: { description: 'Review the current diff' },
    })
    expect(manifest.channels?.[0]?.server).toBe('review-channel')
    expect(manifest.mcpServers).toMatchObject({
      'review-channel': { type: 'stdio', command: 'node' },
    })
  })

  test('supports alternative plugin manifest source formats and strips unknown top-level keys', () => {
    const manifest = PluginManifestSchema().parse({
      name: 'alt-plugin',
      hooks: ['./hooks.json', { PreToolUse: [] }],
      commands: ['./README.md', './skills/review-skill'],
      agents: './agents/reviewer.md',
      skills: ['./skills/reviewer-a', './skills/reviewer-b'],
      outputStyles: './output-styles',
      mcpServers: [
        './mcp.json',
        './bundle.mcpb',
        'https://example.com/review.dxt',
      ],
      lspServers: ['./lsp.json'],
      ignoredTopLevelField: true,
    })

    expect(manifest.hooks).toHaveLength(2)
    expect(manifest.commands).toHaveLength(2)
    expect(manifest.agents).toBe('./agents/reviewer.md')
    expect(manifest.skills).toHaveLength(2)
    expect(manifest.outputStyles).toBe('./output-styles')
    expect(manifest.mcpServers).toHaveLength(3)
    expect('ignoredTopLevelField' in manifest).toBe(false)
  })

  test('validates marketplace source variants and local-source helpers', () => {
    expect(
      MarketplaceSourceSchema().parse({
        source: 'github',
        repo: 'example/plugins',
        ref: 'main',
        sparsePaths: ['.claude-plugin', 'plugins'],
      }),
    ).toMatchObject({ source: 'github', repo: 'example/plugins' })

    expect(
      MarketplaceSourceSchema().parse({
        source: 'settings',
        name: 'internal-marketplace',
        plugins: [
          {
            name: 'review-plugin',
            source: { source: 'github', repo: 'example/review-plugin' },
            strict: false,
          },
        ],
        owner: { name: 'Example' },
      }),
    ).toMatchObject({ source: 'settings', name: 'internal-marketplace' })

    const invalidSettingsSource = MarketplaceSourceSchema().safeParse({
      source: 'settings',
      name: 'claude-code-marketplace',
      plugins: [],
    })
    expect(invalidSettingsSource.success).toBe(false)
    if (invalidSettingsSource.success) {
      throw new Error('expected marketplace settings validation to fail')
    }
    expect(invalidSettingsSource.error.issues[0]?.message).toContain(
      'Reserved official marketplace names cannot be used with settings sources',
    )

    const localSource = MarketplaceSourceSchema().parse({
      source: 'directory',
      path: '/tmp/plugins',
    })
    expect(isLocalMarketplaceSource(localSource)).toBe(true)
    expect(
      isLocalMarketplaceSource(
        MarketplaceSourceSchema().parse({
          source: 'npm',
          package: 'example-marketplace',
        }),
      ),
    ).toBe(false)
  })

  test('parses plugin source variants and identifies local plugin sources', () => {
    expect(PluginSourceSchema().parse('./plugins/reviewer')).toBe(
      './plugins/reviewer',
    )
    expect(
      PluginSourceSchema().parse({
        source: 'npm',
        package: '@example/reviewer',
        version: '^1.0.0',
      }),
    ).toMatchObject({ source: 'npm', package: '@example/reviewer' })
    expect(
      PluginSourceSchema().parse({
        source: 'pip',
        package: 'review-helper',
        registry: 'https://pypi.example.com/simple',
      }),
    ).toMatchObject({ source: 'pip', package: 'review-helper' })
    expect(
      PluginSourceSchema().parse({
        source: 'url',
        url: 'git@github.com:example/reviewer.git',
        sha: 'a'.repeat(40),
      }),
    ).toMatchObject({ source: 'url' })
    expect(
      PluginSourceSchema().parse({
        source: 'git-subdir',
        url: 'example/repo',
        path: 'tools/reviewer',
      }),
    ).toMatchObject({ source: 'git-subdir', path: 'tools/reviewer' })

    expect(isLocalPluginSource('./plugins/reviewer')).toBe(true)
    expect(
      isLocalPluginSource({
        source: 'github',
        repo: 'example/reviewer',
      }),
    ).toBe(false)
  })

  test('parses marketplace entries, plugin IDs, dependencies, and settings plugin references', () => {
    const entry = PluginMarketplaceEntrySchema().parse({
      name: 'review-plugin',
      source: './plugins/review-plugin',
      strict: false,
      description: 'Review helper plugin',
      commands: './README.md',
    })
    expect(entry.strict).toBe(false)

    const marketplace = PluginMarketplaceSchema().parse({
      name: 'internal-marketplace',
      owner: { name: 'Example Team' },
      plugins: [entry],
      forceRemoveDeletedPlugins: true,
      metadata: {
        pluginRoot: './plugins',
        version: '1.0.0',
      },
      allowCrossMarketplaceDependenciesOn: ['shared-marketplace'],
    })
    expect(marketplace.plugins).toHaveLength(1)

    expect(PluginIdSchema().parse('review-plugin@internal-marketplace')).toBe(
      'review-plugin@internal-marketplace',
    )
    expect(DependencyRefSchema().parse('formatter@tools@^2.0.0')).toBe(
      'formatter@tools',
    )
    expect(
      DependencyRefSchema().parse({
        name: 'formatter',
        marketplace: 'tools',
        ignored: true,
      }),
    ).toBe('formatter@tools')

    expect(
      SettingsPluginEntrySchema().parse('review-plugin@internal-marketplace'),
    ).toBe('review-plugin@internal-marketplace')
    expect(
      SettingsPluginEntrySchema().parse({
        id: 'review-plugin@internal-marketplace',
        version: '^2.0.0',
        required: true,
        config: { mode: 'strict' },
      }),
    ).toMatchObject({
      id: 'review-plugin@internal-marketplace',
      required: true,
    })
  })

  test('validates installed plugin metadata and known marketplace registries', () => {
    expect(PluginScopeSchema().parse('project')).toBe('project')

    const installedV1 = InstalledPluginsFileSchemaV1().parse({
      version: 1,
      plugins: {
        'review-plugin@internal-marketplace': {
          version: '1.0.0',
          installedAt: '2024-01-01T00:00:00.000Z',
          installPath: '/tmp/review-plugin',
        },
      },
    })
    expect(installedV1.version).toBe(1)

    const installedV2 = InstalledPluginsFileSchemaV2().parse({
      version: 2,
      plugins: {
        'review-plugin@internal-marketplace': [
          {
            scope: 'project',
            projectPath: '/tmp/project',
            installPath: '/tmp/project/.claude/plugins/review-plugin',
            version: '2.0.0',
          },
        ],
      },
    })
    expect(installedV2.version).toBe(2)
    expect(
      InstalledPluginsFileSchema().parse(installedV2).plugins[
        'review-plugin@internal-marketplace'
      ],
    ).toHaveLength(1)

    const knownMarketplace = KnownMarketplaceSchema().parse({
      source: {
        source: 'github',
        repo: 'example/internal-marketplace',
      },
      installLocation: '/tmp/marketplaces/internal-marketplace',
      lastUpdated: '2024-01-01T00:00:00.000Z',
      autoUpdate: true,
    })
    expect(knownMarketplace.autoUpdate).toBe(true)

    expect(
      KnownMarketplacesFileSchema().parse({
        'internal-marketplace': knownMarketplace,
      }),
    ).toMatchObject({
      'internal-marketplace': {
        installLocation: '/tmp/marketplaces/internal-marketplace',
      },
    })
  })
})
