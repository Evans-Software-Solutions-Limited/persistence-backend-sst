-- Administrative vouchers now cover every supported paid app tier. The FK
-- continues to require a provisioned subscription_tiers row. Application
-- validation derives the supported set from the shared catalogue; marketing-only
-- organisation tiers and Free cannot be issued.
ALTER TABLE business_voucher_batches
 DROP CONSTRAINT IF EXISTS business_voucher_batches_tier_name_check;
ALTER TABLE business_voucher_batches
 ADD CONSTRAINT business_voucher_batches_tier_name_check CHECK (tier_name <> 'free');
-- No existing redemptions, entitlements or founding-pool capacity are changed.
-- Safe application rollback retains this additive schema and all voucher audit.
