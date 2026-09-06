import { SignIn } from "@clerk/react";
import { useAuth } from "@clerk/react";
import { Redirect } from "wouter";

export default function Login() {
  const { isSignedIn, isLoaded } = useAuth();

  // Already signed in — send to dashboard
  if (isLoaded && isSignedIn) return <Redirect to="/" />;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-6 bg-background p-4">
      {/* Light surface, so the master artwork's dark wordmark is the right one. */}
      <img
        src="/logo.png"
        alt="zPOS"
        width={198}
        height={92}
        className="h-12 w-auto"
      />
      <SignIn routing="hash" />
    </div>
  );
}
