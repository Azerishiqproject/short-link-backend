import mongoose, { Schema, InferSchemaType } from "mongoose";

const clickSchema = new Schema(
  {
    linkId: { type: Schema.Types.ObjectId, ref: "Link", required: true, index: true },
    ip: { type: String, required: true },
    country: { type: String, required: true },
    userAgent: { type: String },
    referer: { type: String },
    clickedAt: { type: Date, default: Date.now },
    earnings: { type: Number, default: 0 }, // Her tıklama için kazanılan miktar
  },
  { timestamps: true }
);

const linkSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    targetUrl: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    disabled: { type: Boolean, default: false },
    clicks: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 }, // Link başına toplam kazanç
    lastClickedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

export const Click = mongoose.models.Click || mongoose.model("Click", clickSchema);

export type LinkDocument = InferSchemaType<typeof linkSchema> & { _id: mongoose.Types.ObjectId };

export const Link = mongoose.models.Link || mongoose.model("Link", linkSchema);


