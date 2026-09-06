import { ClerkProvider } from "@clerk/react";
import App from "./App";

/**
 * The dashboard's root, split out of `main.tsx` so that Clerk — and everything
 * that depends on it — sits behind a lazy boundary. A visitor who landed on a
 * storefront never downloads any of it.
 */
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");

export default function AppRoot() {
    return (
        <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
            <App />
        </ClerkProvider>
    );
}
