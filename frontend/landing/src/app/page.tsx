import { LandingPage } from "@/features/landing/LandingPage";
import { homeJsonLd } from "@/features/landing/structuredData";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

export default function Home() {
  return (
    <ErrorBoundary>
      <script
        type="application/ld+json"
        // Static, build-time data only; nothing user-supplied reaches this.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }}
      />
      <LandingPage />
    </ErrorBoundary>
  );
}
