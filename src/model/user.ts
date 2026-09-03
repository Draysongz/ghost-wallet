import { Schema, model, type Document } from "mongoose";

export interface GhostUser extends Document {
  telegram_chat_id: number;

  // Owner EOA address.
  // This is also the Sibyl tenant_id.
  wallet_address: string;

  // ERC-4337 Ghost Smart Account.
  smart_wallet_address: string;

  // Optional reference to external key management.
  // NEVER store the private key itself here.
  smart_wallet_owner_key_ref?: string;

  display_name?: string;

  created_at: Date;
}

const GhostUserSchema = new Schema<GhostUser>({
  telegram_chat_id: {
    type: Number,
    required: true,
    unique: true,
  },

  wallet_address: {
    type: String,
    required: true,
    unique: true,
  },

  smart_wallet_address: {
    type: String,
    required: true,
    unique: true,
  },

  smart_wallet_owner_key_ref: {
    type: String,
    required: false,
  },

  display_name: {
    type: String,
    required: false,
  },

  created_at: {
    type: Date,
    default: Date.now,
  },
});

export const UserModel = model<GhostUser>("GhostUser", GhostUserSchema);