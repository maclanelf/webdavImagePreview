import {
  addCategoryLabel as addCategoryLabelEntry,
  addCustomEvaluationLabel as addCustomEvaluationLabelEntry,
} from './ratingMetadataRepository'
import { mediaRatings } from './mediaRatingRepository'

export interface MediaRatingStoragePayload {
  filePath: string
  fileName: string
  fileType: string
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

export async function saveMediaRatingRecord(data: MediaRatingStoragePayload) {
  return mediaRatings.save(data)
}

export async function addCustomEvaluationLabel(label: string) {
  return addCustomEvaluationLabelEntry(label)
}

export async function addCategoryLabel(name: string) {
  return addCategoryLabelEntry(name)
}
