import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';

export async function advanceCurrentReadiness(input: {
  tx: ReadinessTransaction;
  tenantId: string;
  equipmentId: string;
  snapshotId: string;
  status: string;
  verdict: string | null;
  score: number;
  calculatedAt: Date;
}) {
  await input.tx.$executeRaw`
    INSERT INTO "CurrentReadiness"
      ("tenantId", "equipmentId", "snapshotId", "status", "verdict", "score", "calculatedAt", "updatedAt")
    VALUES
      (${input.tenantId}, ${input.equipmentId}, ${input.snapshotId}, ${input.status}, ${input.verdict},
       ${input.score}, ${input.calculatedAt}, CURRENT_TIMESTAMP)
    ON CONFLICT ("tenantId", "equipmentId") DO UPDATE SET
      "snapshotId" = EXCLUDED."snapshotId",
      "status" = EXCLUDED."status",
      "verdict" = EXCLUDED."verdict",
      "score" = EXCLUDED."score",
      "calculatedAt" = EXCLUDED."calculatedAt",
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE EXCLUDED."calculatedAt" > "CurrentReadiness"."calculatedAt"
       OR (EXCLUDED."calculatedAt" = "CurrentReadiness"."calculatedAt"
           AND EXCLUDED."snapshotId" > "CurrentReadiness"."snapshotId")
  `;
}
