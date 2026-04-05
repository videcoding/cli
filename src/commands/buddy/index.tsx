import type { Command } from '../../commands.js'

const buddy = {
  type: 'local-jsx',
  name: 'buddy',
  description: 'Hatch a coding companion · pet, off',
  argumentHint: '[pet|off]',
  immediate: true,
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
