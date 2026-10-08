import { type SchemaTypeDefinition } from 'sanity'

import { projectType } from './documents/project'
import { projectGalleryType } from './objects/projectGallery'
import { projectTextType } from './objects/projectText'
import { statType } from './objects/stat'

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [projectType, projectTextType, projectGalleryType, statType],
}
