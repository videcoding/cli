import { describe, expect, test } from 'bun:test'
import { parsePluginArgs } from '../../../src/commands/plugin/parseArgs.ts'

describe('parsePluginArgs', () => {
  test('defaults to the plugin menu when no args are provided', () => {
    expect(parsePluginArgs()).toEqual({ type: 'menu' })
    expect(parsePluginArgs('')).toEqual({ type: 'menu' })
  })

  test('parses help aliases', () => {
    expect(parsePluginArgs('help')).toEqual({ type: 'help' })
    expect(parsePluginArgs('--help')).toEqual({ type: 'help' })
    expect(parsePluginArgs('-h')).toEqual({ type: 'help' })
  })

  test('parses plugin install targets', () => {
    expect(parsePluginArgs('install')).toEqual({ type: 'install' })
    expect(parsePluginArgs('install hello-world')).toEqual({
      type: 'install',
      plugin: 'hello-world',
    })
    expect(parsePluginArgs('i demo@official')).toEqual({
      type: 'install',
      plugin: 'demo',
      marketplace: 'official',
    })
  })

  test('treats URLs and filesystem-like install targets as marketplaces', () => {
    expect(parsePluginArgs('install https://example.com/marketplace.json')).toEqual({
      type: 'install',
      marketplace: 'https://example.com/marketplace.json',
    })
    expect(parsePluginArgs('install ./fixtures/local-marketplace.json')).toEqual({
      type: 'install',
      marketplace: './fixtures/local-marketplace.json',
    })
  })

  test('preserves validate paths with spaces', () => {
    expect(parsePluginArgs('validate ./plugins/My Plugin')).toEqual({
      type: 'validate',
      path: './plugins/My Plugin',
    })
  })

  test('parses marketplace subcommands', () => {
    expect(parsePluginArgs('marketplace add https://example.com/index.json')).toEqual({
      type: 'marketplace',
      action: 'add',
      target: 'https://example.com/index.json',
    })
    expect(parsePluginArgs('market rm local')).toEqual({
      type: 'marketplace',
      action: 'remove',
      target: 'local',
    })
    expect(parsePluginArgs('marketplace update private')).toEqual({
      type: 'marketplace',
      action: 'update',
      target: 'private',
    })
    expect(parsePluginArgs('marketplace list')).toEqual({
      type: 'marketplace',
      action: 'list',
    })
    expect(parsePluginArgs('marketplace')).toEqual({ type: 'marketplace' })
  })

  test('falls back to menu for unknown commands', () => {
    expect(parsePluginArgs('something-else')).toEqual({ type: 'menu' })
  })
})
