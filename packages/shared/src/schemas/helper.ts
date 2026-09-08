import { z } from "zod";

export const decimalNumber = z.preprocess(
    (val) => {
        if (typeof val === "string") {
            const parsed = Number(val);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return val;
    },
    z
        .number({ error: "Value is required" })
        .positive("Must be greater than 0")
        .refine(
            (v) => Number(v.toFixed(2)) === v,
            "Maximum 2 decimal places allowed"
        )
);

export const decimalOptional = z
    .preprocess(
        (val) => {
            if (val === "" || val === undefined || val === null)
                return undefined;

            if (typeof val === "string") {
                const parsed = Number(val);
                return Number.isFinite(parsed) ? parsed : undefined;
            }

            return val;
        },
        z
            .number()
            .refine(
                (v) => Number(v.toFixed(2)) === v,
                "Maximum 2 decimal places allowed"
            )
    )
    .optional();

export const decimalOptionalZero = z
    .preprocess((val) => {
        if (val === "" || val === undefined || val === null) {
            return 0;
        }

        if (typeof val === "string") {
            const parsed = Number(val);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        if (typeof val === "number") {
            return val;
        }

        return 0;
    },
        z.number().refine(
            (v) => Number(v.toFixed(2)) === v,
            "Maximum 2 decimal places allowed"
        ));

export const zodUUID = z.string().uuid("Invalid UUID");
export const zodUUIDArray = z.array(zodUUID);
export const zodUUIDOptional = z.string().uuid().optional();
export const zodDate = z.coerce.date();

// Shared body shape for the many "act on one record by id" mutation
// endpoints (deletes, toggles, cancels) so they go through the same
// validation layer instead of ad-hoc c.req.json() checks.
export const idBodySchema = z.object({ id: zodUUID });
export type IdBody = z.infer<typeof idBodySchema>;

export const uuidOptional = z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.string().uuid().optional()
);

/**
 * An optional email field that a blank input actually satisfies.
 *
 * `z.string().email().optional()` does not do this. An untouched text input
 * submits `""`, not `undefined` — and `""` is still a string, so it reaches the
 * email check and fails. A field the form labels "(Optional)" then blocks the
 * whole submit, and because the failure is a validation error rather than a
 * request, the button simply appears dead.
 */
export const emailOptional = z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().email("Invalid email").optional()
);

/**
 * Optional free text that stores nothing when nothing was typed.
 *
 * Same empty-string problem, one step milder: `""` passes validation but then
 * lands in the database as an empty string, so "no invoice number" and "an
 * invoice number that is blank" become two different rows to every later query.
 */
export const textOptional = z.preprocess(
    (val) => {
        if (typeof val !== "string") return val;
        const trimmed = val.trim();
        return trimmed === "" ? undefined : trimmed;
    },
    z.string().optional()
);

export const bangladeshiPhoneSchema = z.string().regex(
    /^(?:\+8801|8801|01)[3-9]\d{8}$/,
    "Invalid Bangladeshi phone number"
);