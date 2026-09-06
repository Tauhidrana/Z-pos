/**
 * One-off migration: rewrite legacy `BC00000001`-style barcodes as real EAN-13.
 *
 * The seed issued placeholder codes that no scanner can read and that the sale
 * API rejects outright — `saleSchema` requires exactly 13 characters, so every
 * attempt to sell a seeded product failed validation with "Too small: expected
 * string to have >=13 characters". Only stock bought through the Purchases page
 * (which calls `generateEAN13`) was sellable.
 *
 * Each barcode's `serial` is already unique and is exactly what `generateEAN13`
 * keys off, so regenerating from it produces a unique, check-digit-correct code
 * without touching allocations, sales history or stock.
 *
 * Idempotent: codes that are already valid EAN-13 are left alone.
 *
 *   bun run scripts/migrate-barcodes-to-ean13.ts [--apply]
 *
 * Without --apply it performs a dry run and writes nothing.
 */
import { Prisma } from "../generated/prisma";
import prisma from "../src/lib/prisma";
import { generateEAN13, validateEAN13 } from "../src/lib/barcode";

const apply = process.argv.includes("--apply");

/**
 * Drag `barcodes_serial_seq` up past the largest serial in the table.
 *
 * Barcode codes are a pure function of the serial, so a sequence that trails
 * `MAX(serial)` hands out values whose EAN-13 already exists and every insert
 * dies on the unique index over `barcodes.code`. That breaks recording a
 * purchase, not just this migration. Rows inserted with an explicit serial
 * (as the purchase flow does, after reserving one) never advance the sequence,
 * and a restore or a `db push` can leave it behind as well.
 *
 * Safe to run repeatedly: setval to an already-correct value is a no-op.
 */
async function resyncSerialSequence(): Promise<void> {
    const [row] = await prisma.$queryRaw<Array<{ max_serial: number | null; next_value: number }>>(
        Prisma.sql`
            SELECT MAX(serial)::int AS max_serial,
                   (last_value + CASE WHEN is_called THEN 1 ELSE 0 END)::int AS next_value
            FROM barcodes, barcodes_serial_seq
            GROUP BY last_value, is_called
        `,
    );

    const maxSerial = row?.max_serial ?? 0;
    const nextValue = row?.next_value ?? 1;

    if (nextValue > maxSerial) {
        console.log(`Sequence already ahead of MAX(serial) (${nextValue} > ${maxSerial}) — left alone.`);
        return;
    }

    await prisma.$executeRaw(Prisma.sql`SELECT setval('barcodes_serial_seq', ${maxSerial}::bigint, true)`);
    console.log(
        `Sequence resynced: nextval() would have returned ${nextValue}, colliding with existing ` +
        `serials up to ${maxSerial}; it now resumes at ${maxSerial + 1}.`,
    );
}

const all = await prisma.barcode.findMany({
    select: { id: true, code: true, serial: true, status: true },
    orderBy: { serial: "asc" },
});

const stale = all.filter((b) => !validateEAN13(b.code));
const alreadyValid = all.length - stale.length;

console.log(`${all.length} barcodes: ${alreadyValid} already valid EAN-13, ${stale.length} to migrate`);
if (stale.length === 0) {
    // The codes may already be fine while the sequence behind them is not, so
    // this still has work to do.
    if (apply) await resyncSerialSequence();
    else console.log("Dry run — pass --apply to resync the serial sequence if needed.");
    process.exit(0);
}

// Build the new codes up front so a collision aborts before anything is written.
const taken = new Set(all.map((b) => b.code));
const planned = new Map<string, string>();

for (const bc of stale) {
    const next = generateEAN13(bc.serial);
    if (taken.has(next)) {
        throw new Error(`Collision: serial ${bc.serial} -> ${next} is already in use`);
    }
    taken.delete(bc.code);
    taken.add(next);
    planned.set(bc.id, next);
}

for (const bc of stale.slice(0, 5)) {
    console.log(`  ${bc.code.padEnd(14)} -> ${planned.get(bc.id)}  (serial ${bc.serial}, ${bc.status})`);
}
if (stale.length > 5) console.log(`  ... and ${stale.length - 5} more`);

if (!apply) {
    console.log("\nDry run — pass --apply to write these changes.");
    process.exit(0);
}

// One bulk UPDATE rather than 120 round-trips. Issuing them individually inside
// $transaction blew the 5s interactive-transaction budget against a hosted
// database and rolled the whole thing back. A single statement is also
// atomic, which is what matters here: a partial run would leave the table
// half-migrated with no safe way to resume.
const values = Prisma.join(
    // `barcodes.id` is a Prisma `String`, so Postgres stores it as text — not a
    // native uuid column. Casting to ::uuid here fails with
    // "operator does not exist: text = uuid".
    stale.map((bc) => Prisma.sql`(${bc.id}::text, ${planned.get(bc.id)!}::text)`),
);

const updated = await prisma.$executeRaw(
    Prisma.sql`
        UPDATE barcodes AS b
        SET code = v.new_code
        FROM (VALUES ${values}) AS v(id, new_code)
        WHERE b.id = v.id
    `,
);

console.log(`rows updated: ${updated}`);

await resyncSerialSequence();

const after = await prisma.barcode.findMany({ select: { code: true } });
const invalid = after.filter((b) => !validateEAN13(b.code));
console.log(`\nMigrated ${stale.length}. Invalid codes remaining: ${invalid.length}`);
process.exit(0);
