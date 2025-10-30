import mongoose, { Schema, InferSchemaType } from "mongoose";

const emailVerificationSchema = new Schema(
  {
    email: { type: String, required: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: false },
    referralCodeInput: { type: String, required: false },
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    registrationIp: { type: String, required: false },
    registrationDeviceId: { type: String, required: false },
    code: { type: String, required: true }, // 6-digit code as string
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type EmailVerificationDocument = InferSchemaType<typeof emailVerificationSchema> & { _id: mongoose.Types.ObjectId };

export const EmailVerification = mongoose.models.EmailVerification || mongoose.model("EmailVerification", emailVerificationSchema);


