import { Schema, model, InferSchemaType } from 'mongoose'

/** A browser Web Push subscription (one per device/browser per user). */
const pushSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: String,
  },
  { timestamps: true, versionKey: false }
)

export type PushSubscriptionDoc = InferSchemaType<typeof pushSubscriptionSchema>
export const PushSubscription = model('PushSubscription', pushSubscriptionSchema)
