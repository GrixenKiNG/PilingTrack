-- Left behind by the removed operator-v3 offline-authority feature
-- (20260826150000_operator_v3_offline_authority). The application never reads
-- or writes it, and the table is empty in every environment: 0 rows locally and
-- 0 on production, checked 2026-09-13 before writing this.
--
-- Only the DeviceSyncState copy goes. TrustedOperatorDeviceRecord has a column
-- of the same name that is still declared in schema.prisma and stays.
ALTER TABLE "DeviceSyncState" DROP COLUMN "lastAcceptedSequence";
