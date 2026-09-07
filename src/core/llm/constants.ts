export const DEFAULT_MODELS = {
  text: 'gemini-3-flash-preview',
  image: 'z-image-turbo',
  music: 'lyria-3-clip-preview',
  video: 'veo-3.1-lite-generate-preview'
} as const;

export const AVAILABLE_MODELS = {
  text: [
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite-preview'
  ],
  image: [
    'z-image-turbo'
  ],
  music: [
    'lyria-3-clip-preview',
    'lyria-3-pro-preview'
  ],
  video: [
    'veo-3.1-lite-generate-preview',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-generate-preview'
  ]
} as const;

export type ModelType = keyof typeof AVAILABLE_MODELS;
