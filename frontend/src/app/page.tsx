import { LandingPage } from "@/features/landing/LandingPage";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

export default function Home() {
  return (
    <ErrorBoundary>
      <LandingPage />
    </ErrorBoundary>
  );
}
