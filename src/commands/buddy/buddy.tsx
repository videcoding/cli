import figures from 'figures'
import React, { useEffect, useState } from 'react'
import { z } from 'zod/v4'
import { Box, Text, useInput } from '../../ink.js'
import { sideQuery } from '../../utils/sideQuery.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { logError } from '../../utils/log.js'
import { getDefaultSonnetModel } from '../../utils/model/model.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import {
  getLastBuddyReaction,
  generateCompanionHatchReaction,
  generateCompanionPetReaction,
} from '../../buddy/reactions.js'
import {
  companionUserId,
  getCompanion,
  roll,
  type Roll,
} from '../../buddy/companion.js'
import { renderSprite } from '../../buddy/sprites.js'
import {
  RARITY_COLORS,
  RARITY_STARS,
  STAT_NAMES,
  type Companion,
  type CompanionBones,
} from '../../buddy/types.js'

const inspirationWords = [
  'thunder',
  'biscuit',
  'void',
  'accordion',
  'moss',
  'velvet',
  'rust',
  'pickle',
  'crumb',
  'whisper',
  'gravy',
  'frost',
  'ember',
  'soup',
  'marble',
  'thorn',
  'honey',
  'static',
  'copper',
  'dusk',
  'sprocket',
  'bramble',
  'cinder',
  'wobble',
  'drizzle',
  'flint',
  'tinsel',
  'murmur',
  'clatter',
  'gloom',
  'nectar',
  'quartz',
  'shingle',
  'tremor',
  'umber',
  'waffle',
  'zephyr',
  'bristle',
  'dapple',
  'fennel',
  'gristle',
  'huddle',
  'kettle',
  'lumen',
  'mottle',
  'nuzzle',
  'pebble',
  'quiver',
  'ripple',
  'sable',
  'thistle',
  'vellum',
  'wicker',
  'yonder',
  'bauble',
  'cobble',
  'doily',
  'fickle',
  'gambit',
  'hubris',
  'jostle',
  'knoll',
  'larder',
  'mantle',
  'nimbus',
  'oracle',
  'plinth',
  'quorum',
  'relic',
  'spindle',
  'trellis',
  'urchin',
  'vortex',
  'warble',
  'xenon',
  'yoke',
  'zenith',
  'alcove',
  'brogue',
  'chisel',
  'dirge',
  'epoch',
  'fathom',
  'glint',
  'hearth',
  'inkwell',
  'jetsam',
  'kiln',
  'lattice',
  'mirth',
  'nook',
  'obelisk',
  'parsnip',
  'quill',
  'rune',
  'sconce',
  'tallow',
  'umbra',
  'verve',
  'wisp',
  'yawn',
  'apex',
  'brine',
  'crag',
  'dregs',
  'etch',
  'flume',
  'gable',
  'husk',
  'ingot',
  'jamb',
  'knurl',
  'loam',
  'mote',
  'nacre',
  'ogle',
  'prong',
  'quip',
  'rind',
  'slat',
  'tuft',
  'vane',
  'welt',
  'yarn',
  'bane',
  'clove',
  'dross',
  'eave',
  'fern',
  'grit',
  'hive',
  'jade',
  'keel',
  'lilt',
  'muse',
  'nape',
  'omen',
  'pith',
  'rook',
  'silt',
  'tome',
  'urge',
  'vex',
  'wane',
  'yew',
  'zest',
] as const

const fallbackNames = ['Crumpet', 'Soup', 'Pickle', 'Biscuit', 'Moth', 'Gravy']

const buddySoulSchema = z.object({
  name: z.string().min(1).max(14),
  personality: z.string(),
})

const BUDDY_SYSTEM_PROMPT = `You generate coding companions - small creatures that live in a developer's terminal and occasionally comment on their work.

Given a rarity, species, stats, and a handful of inspiration words, invent:
- A name: ONE word, max 12 characters. Memorable, slightly absurd. No titles, no "the X", no epithets. Think pet name, not NPC name. The inspiration words are loose anchors - riff on one, mash two syllables, or just use the vibe. Examples: Pith, Dusker, Crumb, Brogue, Sprocket.
- A one-sentence personality (specific, funny, a quirk that affects how they'd comment on code - should feel consistent with the stats)

Higher rarity = weirder, more specific, more memorable. A legendary should be genuinely strange.
Don't repeat yourself - every companion should feel distinct.`

function pickInspiration(seed: number, count: number): string[] {
  let value = seed >>> 0
  const indexes = new Set<number>()

  while (indexes.size < count) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    indexes.add(value % inspirationWords.length)
  }

  return [...indexes].map(index => inspirationWords[index]!)
}

function fallbackSoul(bones: CompanionBones): z.infer<typeof buddySoulSchema> {
  const index = bones.species.charCodeAt(0) + bones.eye.charCodeAt(0)
  return {
    name: fallbackNames[index % fallbackNames.length]!,
    personality: `A ${bones.rarity} ${bones.species} of few words.`,
  }
}

async function generateSoul(
  bones: CompanionBones,
  inspirationSeed: number,
): Promise<z.infer<typeof buddySoulSchema>> {
  const words = pickInspiration(inspirationSeed, 4)
  const stats = STAT_NAMES.map(name => `${name}:${bones.stats[name]}`).join(' ')
  const prompt = `Generate a companion.
Rarity: ${bones.rarity.toUpperCase()}
Species: ${bones.species}
Stats: ${stats}
Inspiration words: ${words.join(', ')}
${bones.shiny ? 'SHINY variant - extra special.' : ''}

Make it memorable and distinct.`

  try {
    const result = await sideQuery({
      querySource: 'buddy_companion',
      model: getDefaultSonnetModel(),
      system: BUDDY_SYSTEM_PROMPT,
      skipSystemPromptPrefix: true,
      messages: [{ role: 'user', content: prompt }],
      output_format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 14 },
            personality: { type: 'string' },
          },
          required: ['name', 'personality'],
          additionalProperties: false,
        },
      },
      max_tokens: 512,
      temperature: 1,
    })

    const textBlock = result.content.find(block => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('buddy soul query returned no text block')
    }

    return buddySoulSchema.parse(JSON.parse(textBlock.text))
  } catch (error) {
    logError(error)
    return fallbackSoul(bones)
  }
}

function BuddyPanel({
  companion,
  lastReaction,
  onDone,
}: {
  companion: Companion
  lastReaction?: string
  onDone: () => void
}): React.ReactNode {
  useInput(() => {
    onDone()
  })

  const color = RARITY_COLORS[companion.rarity]
  const sprite = renderSprite(companion, 0)

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={color} paddingX={2} paddingY={1}>
        <Box flexDirection="column" width={40}>
          <Box justifyContent="space-between">
            <Text bold color={color}>
              {RARITY_STARS[companion.rarity]} {companion.rarity.toUpperCase()}
            </Text>
            <Text color={color}>{companion.species.toUpperCase()}</Text>
          </Box>
          {companion.shiny ? (
            <Text color="warning" bold>
              ✨ SHINY ✨
            </Text>
          ) : null}
          <Box flexDirection="column" marginY={1}>
            {sprite.map((line, index) => (
              <Text key={index} color={color}>
                {line}
              </Text>
            ))}
          </Box>
          <Text bold>{companion.name}</Text>
          <Box marginY={1}>
            <Text dimColor italic>
              "{companion.personality}"
            </Text>
          </Box>
          <Box flexDirection="column">
            {STAT_NAMES.map(name => {
              const value = companion.stats[name]
              const filled = Math.round(value / 10)
              return (
                <Box key={name}>
                  <Text>{name.padEnd(10)} </Text>
                  <Text>{'█'.repeat(filled)}{'░'.repeat(10 - filled)} </Text>
                  <Text dimColor>{String(value).padStart(3)}</Text>
                </Box>
              )
            })}
          </Box>
          {lastReaction ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>last said</Text>
              <Box borderStyle="round" borderColor="inactive" paddingX={1}>
                <Text dimColor italic>
                  {lastReaction}
                </Text>
              </Box>
            </Box>
          ) : null}
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{companion.name} is here - it'll chime in as you code</Text>
        <Text dimColor>say its name to get its take - /buddy pet - /buddy off</Text>
        <Text dimColor>press any key</Text>
      </Box>
    </Box>
  )
}

function BuddyHatching({
  hatching,
  onDone,
}: {
  hatching: Promise<Companion>
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const [companion, setCompanion] = useState<Companion | null>(null)

  useEffect(() => {
    let cancelled = false

    hatching
      .then(result => {
        if (!cancelled) {
          setCompanion(result)
        }
      })
      .catch(error => {
        logError(error)
        if (!cancelled) {
          onDone('Failed to hatch buddy', { display: 'system' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [hatching, onDone])

  if (!companion) {
    return (
      <Box flexDirection="column" alignItems="center" borderStyle="round" paddingY={1}>
        <Text dimColor>hatching a coding buddy...</Text>
        <Text dimColor>it'll watch you work and occasionally have opinions</Text>
      </Box>
    )
  }

  return (
    <BuddyPanel
      companion={companion}
      lastReaction={getLastBuddyReaction()}
      onDone={() => onDone(undefined, { display: 'skip' })}
    />
  )
}

async function hatchCompanion(
  context: LocalJSXCommandContext,
): Promise<Companion> {
  const rolled: Roll = roll(companionUserId())
  const soul = await generateSoul(rolled.bones, rolled.inspirationSeed)
  const hatchedAt = Date.now()

  saveGlobalConfig(current => ({
    ...current,
    companion: {
      name: soul.name,
      personality: soul.personality,
      hatchedAt,
    },
    companionMuted: false,
  }))

  const companion = {
    ...rolled.bones,
    ...soul,
    hatchedAt,
  } satisfies Companion

  void generateCompanionHatchReaction(companion, reaction =>
    context.setAppState(prev =>
      prev.companionReaction === reaction
        ? prev
        : { ...prev, companionReaction: reaction },
    ),
  )

  return companion
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const arg = args.trim()
  const config = getGlobalConfig()

  if (arg === 'off') {
    if (config.companionMuted !== true) {
      saveGlobalConfig(current => ({ ...current, companionMuted: true }))
    }
    onDone('companion muted', { display: 'system' })
    return null
  }

  if (arg === 'on') {
    if (config.companionMuted === true) {
      saveGlobalConfig(current => ({ ...current, companionMuted: false }))
    }
    onDone('companion unmuted', { display: 'system' })
    return null
  }

  if (arg === 'pet') {
    const companion = getCompanion()
    if (!companion) {
      onDone('no companion yet - run /buddy first', { display: 'system' })
      return null
    }

    if (config.companionMuted === true) {
      saveGlobalConfig(current => ({ ...current, companionMuted: false }))
    }

    context.setAppState(prev => ({ ...prev, companionPetAt: Date.now() }))
    void generateCompanionPetReaction(reaction =>
      context.setAppState(prev =>
        prev.companionReaction === reaction
          ? prev
          : { ...prev, companionReaction: reaction },
      ),
    )
    onDone(`petted ${companion.name}`, { display: 'system' })
    return null
  }

  if (config.companionMuted === true) {
    saveGlobalConfig(current => ({ ...current, companionMuted: false }))
  }

  const companion = getCompanion()
  if (companion) {
    return (
      <BuddyPanel
        companion={companion}
        lastReaction={getLastBuddyReaction()}
        onDone={() => onDone(undefined, { display: 'skip' })}
      />
    )
  }

  return <BuddyHatching hatching={hatchCompanion(context)} onDone={onDone} />
}
