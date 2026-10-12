-- AUTO-GENERATED schema parity indexes (run AFTER columns).
CREATE INDEX IF NOT EXISTS idx_user_actions_user 
      ON user_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_actions_category 
      ON user_actions(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_venues_owner ON partner_venues(owner_id);
CREATE INDEX IF NOT EXISTS idx_classes_partner_id ON classes(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_members_user ON partner_members(user_id);
CREATE INDEX IF NOT EXISTS idx_partner_members_partner ON partner_members(partner_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_entity ON blockchain_blocks(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_height ON blockchain_blocks(block_height);
CREATE INDEX IF NOT EXISTS idx_blockchain_created ON blockchain_blocks(created_at);
CREATE INDEX IF NOT EXISTS idx_partner_reference ON partner_venues(partner_reference);
