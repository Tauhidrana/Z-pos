import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

/**
 * A react-hook-form resolver that actually works with Zod 4.
 *
 * The project's `@hookform/resolvers@3` predates Zod 4 and detects a validation
 * failure with `Array.isArray(error.errors)`. Zod 4 renamed that property to
 * `issues` and dropped the old alias, so the check always fails, the resolver
 * re-throws, and the result is a form that renders no messages at all while
 * throwing an uncaught ZodError on every blur — validation that looks wired up
 * and silently does nothing.
 *
 * Upgrading the dependency is the better long-term fix, but v5 tightens the
 * input/output typing enough that several existing forms need signature changes
 * alongside it. This keeps the fix local: `safeParse` never throws, so there is
 * no error shape to sniff in the first place.
 *
 * Swap `zodResolver` for this in any form that needs working validation; the
 * call signature is the same.
 */
export function zod4Resolver<TFieldValues extends FieldValues>(
    schema: ZodType<TFieldValues, unknown>,
): Resolver<TFieldValues> {
    return async (values) => {
        const result = await schema.safeParseAsync(values);

        if (result.success) {
            return { values: result.data, errors: {} };
        }

        // react-hook-form addresses fields by dotted path ("address.division",
        // "items.0.quantity"), which is exactly what a Zod issue path joins to.
        // First message per field wins — showing five errors under one input is
        // noise, and the first is the one the shopper has to fix anyway.
        const errors: Record<string, { type: string; message: string }> = {};
        for (const issue of result.error.issues) {
            const path = issue.path.join(".");
            if (path && !errors[path]) {
                errors[path] = { type: issue.code, message: issue.message };
            }
        }

        return { values: {}, errors: errors as FieldErrors<TFieldValues> };
    };
}
