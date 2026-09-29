import { Navbar } from "./sections/Navbar";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { Products } from "./sections/Products";
import { Evidence } from "./sections/Evidence";
import { ClosingCard, Footer } from "./sections/Closing";
import { ScrollReveal } from "./sections/ScrollReveal";
import "./landing.css";

export function LandingPage() {
  return (
    <div className="landing" id="top">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Products />
        <Evidence />
        <ClosingCard />
      </main>
      <Footer />
      <ScrollReveal />
    </div>
  );
}
