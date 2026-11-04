import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/icons";
import { useTheme } from "../hooks/useTheme";
import { useAuth } from "../hooks/useAuth";
import { ownerAuthService } from "../services/ownerAuthService";
import { isCapacitorNativeApp, isInstalledApp } from "../utils/capacitor";

// Photography Assets (Public URLs for parallel preloading & PWA caching)
const logoImg = "/logo.jpg";
const heroInspectorImg = "/hero-inspector.jpg";
const aboutVetImg = "/about-veterinarian.jpg";
const inspectionImg = "/inspection-postmortem.jpg";
const facilityBgImg = "/lsmis-facility-bg.jpg";

// Official Google 4-Color "G" Brand Logo
const GoogleLogo = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    style={{ flexShrink: 0 }}
  >
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

const NAV_ITEMS = [
  { label: "Home", href: "#top" },
  { label: "About", href: "#about" },
  { label: "Features", href: "#features" },
  { label: "Workflow", href: "#workflow" },
  { label: "Contact", href: "#contact" },
];

const FEATURE_MODULES = [
  {
    title: "Livestock Registration",
    desc: "Digital intake of owner credentials, shipping permits, provenance verification, and lairage penning allocation.",
    icon: <Icon.Cow size={22} />,
  },
  {
    title: "Animal Marking",
    desc: "Official ear tag and lot identification marking, establishing end-to-end traceability across slaughter lines.",
    icon: <Icon.Tag size={22} />,
  },
  {
    title: "Ante-Mortem Inspection",
    desc: "Clinical veterinary screening for animal disease indicators, quarantine evaluation, and slaughter fitness clearances.",
    icon: <Icon.Stethoscope size={22} />,
  },
  {
    title: "Slaughter Operations",
    desc: "Sequential monitoring of humane stunning, bleeding, scalding, dehairing, and sanitary evisceration line processing.",
    icon: <Icon.Activity size={22} />,
  },
  {
    title: "Post-Mortem Inspection",
    desc: "Rigorous veterinary pathological examination of head, visceral organs, carcass halves, and condemnation logging.",
    icon: <Icon.ClipboardCheck size={22} />,
  },
  {
    title: "Carcass Weighing",
    desc: "Precise digital scale capture of warm dressed carcass weights, meat grading, and condemnation accounting.",
    icon: <Icon.Scale size={22} />,
  },
  {
    title: "Meat Permit Management",
    desc: "Automated generation and issuance of official Meat Inspection Certificates (MIC) and distribution gate clearances.",
    icon: <Icon.FileText size={22} />,
  },
  {
    title: "Records and Reports",
    desc: "Regulatory abattoir audit trails, daily slaughter summaries, fee reconciliations, and statutory compliance logs.",
    icon: <Icon.Report size={22} />,
  },
];

const WORKFLOW_STEPS = [
  {
    step: 1,
    title: "Register Livestock",
    role: "Slaughterhouse Staff",
    roleType: "staff",
    desc: "Intake validation of livestock ownership, certificates, origin, and municipal lairage pen assignment.",
    icon: <Icon.Cow size={18} />,
  },
  {
    step: 2,
    title: "Animal Marking",
    role: "Slaughterhouse Staff",
    roleType: "staff",
    desc: "Assignment of official tamper-evident ear tags and lot numbers for complete municipal tracking.",
    icon: <Icon.Tag size={18} />,
  },
  {
    step: 3,
    title: "Ante-Mortem Inspection",
    role: "Veterinary Inspector",
    roleType: "vet",
    desc: "Clinical veterinary examination of live animals to screen for disease symptoms and verify slaughter fitness.",
    icon: <Icon.Stethoscope size={18} />,
  },
  {
    step: 4,
    title: "Assign Team Operator",
    role: "Slaughterhouse Staff",
    roleType: "staff",
    desc: "Designation of certified slaughterhouse teams to approved animals awaiting slaughter line execution.",
    icon: <Icon.Users size={18} />,
  },
  {
    step: 5,
    title: "Ready for Slaughter",
    role: "Slaughterhouse Staff",
    roleType: "staff",
    desc: "Execution of humane stunning, bleeding, scalding, dehairing, and sanitary processing line protocols.",
    icon: <Icon.Scissors size={18} />,
  },
  {
    step: 6,
    title: "Post-Mortem Inspection",
    role: "Veterinary Inspector",
    roleType: "vet",
    desc: "Detailed pathological exam of head, visceral internal organs, and split carcass halves for food safety.",
    icon: <Icon.ClipboardCheck size={18} />,
  },
  {
    step: 7,
    title: "Carcass Weighing",
    role: "Veterinary Inspector",
    roleType: "vet",
    desc: "Digital scale weighing of warm dressed carcass, official grade stamping, and final sanitary clearance.",
    icon: <Icon.Scale size={18} />,
  },
  {
    step: 8,
    title: "Meat Permit",
    role: "Slaughterhouse Staff",
    roleType: "staff",
    desc: "Issuance of official Meat Inspection Certificates (MIC) and authorized municipal dispatch gate passes.",
    icon: <Icon.FileText size={18} />,
  },
];

export const LandingPage = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("top");
  const [googleLoading, setGoogleLoading] = useState(false);
  const mobileMenuRef = useRef(null);

  const { theme, toggleTheme } = useTheme();
  const { role, isAuthenticated, loading: authLoading, isInitialized: authInitialized } = useAuth();
  const navigate = useNavigate();

  // Installed app check: direct bypass to dashboard or login
  useEffect(() => {
    if (isInstalledApp()) {
      if (authLoading || !authInitialized) return;
      if (isAuthenticated && role) {
        navigate(`/${role}`, { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authLoading, authInitialized, isAuthenticated, role, navigate]);

  // Scroll detection for navbar transition
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 30);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // IntersectionObserver for active nav scroll-spy
  useEffect(() => {
    const sectionIds = ["top", "about", "features", "workflow", "contact"];
    const observerOptions = {
      root: null,
      rootMargin: "-20% 0px -70% 0px",
      threshold: 0,
    };

    const handleIntersect = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
        }
      });
    };

    const observer = new IntersectionObserver(handleIntersect, observerOptions);
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  // Mobile drawer keyboard accessibility & body scroll lock
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  // Smooth scroll handler with offset
  const scrollToSection = useCallback((e, href) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const targetId = href.replace("#", "");
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth" });
      history.pushState(null, "", href);
      setActiveSection(targetId);
    }
  }, []);

  // Preserved Google Sign-In for Livestock Owners
  const handleMobileGoogleSignIn = async () => {
    if (googleLoading) return;
    setGoogleLoading(true);
    setMobileMenuOpen(false);
    try {
      const res = await ownerAuthService.signInWithGoogle({ intent: "login" });
      if (res?.url) {
        ownerAuthService.setGoogleOAuthInFlight("login");
        window.location.assign(res.url);
      } else {
        navigate("/login");
      }
    } catch (_) {
      setGoogleLoading(false);
      navigate("/login");
    }
  };

  return (
    <div className="landing-page" id="top">
      {/* =========================================================
          1. NAVIGATION BAR
          ========================================================= */}
      <header
        className={`landing-nav-header ${isScrolled ? "nav-scrolled" : "nav-transparent"}`}
        role="banner"
      >
        <div className="landing-container">
          <div className="landing-nav-inner">
            {/* Brand Logo & Institutional Label */}
            <a
              href="#top"
              onClick={(e) => scrollToSection(e, "#top")}
              className="nav-brand-link"
              aria-label="City of Naga LSMIS - Home"
            >
              <div className="nav-brand-logo">
                <img src={logoImg} alt="City of Naga LSMIS Seal" width="44" height="44" />
              </div>
              <div className="nav-brand-text">
                <span className="nav-brand-title">LSMIS</span>
                <span className="nav-brand-sub">City of Naga · Slaughterhouse</span>
              </div>
            </a>

            {/* Desktop Navigation Links */}
            <nav className="nav-menu-desktop" aria-label="Main Navigation">
              {NAV_ITEMS.map((item) => {
                const id = item.href.replace("#", "");
                const isActive = activeSection === id;
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={(e) => scrollToSection(e, item.href)}
                    className={`nav-menu-link ${isActive ? "active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>

            {/* Nav Actions: Theme Toggle, Mobile Toggle, Login */}
            <div className="nav-actions">
              <button
                type="button"
                className="nav-theme-toggle"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {theme === "dark" ? <Icon.Sun size={17} /> : <Icon.Moon size={17} />}
              </button>

              <Link to="/login" className="nav-btn-login">
                <Icon.LogIn size={15} />
                <span>Login</span>
              </Link>

              <button
                type="button"
                className="nav-mobile-toggle"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open mobile navigation menu"
                aria-expanded={mobileMenuOpen}
              >
                <Icon.Menu size={22} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Nav Backdrop Overlay */}
      {mobileMenuOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Nav Drawer */}
      <div
        ref={mobileMenuRef}
        className={`mobile-nav-panel ${mobileMenuOpen ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation Menu"
      >
        <div className="mobile-nav-top">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={logoImg} alt="LSMIS" width="32" height="32" style={{ borderRadius: "50%" }} />
            <span style={{ fontWeight: 800, fontSize: 16, color: "var(--lsmis-charcoal-900)" }}>
              LSMIS Naga
            </span>
          </div>
          <button
            type="button"
            className="mobile-nav-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
          >
            <Icon.X size={20} />
          </button>
        </div>

        <nav className="mobile-nav-links" aria-label="Mobile Navigation">
          {NAV_ITEMS.map((item) => {
            const id = item.href.replace("#", "");
            const isActive = activeSection === id;
            return (
              <a
                key={item.label}
                href={item.href}
                onClick={(e) => scrollToSection(e, item.href)}
                className={`mobile-nav-link-item ${isActive ? "active" : ""}`}
              >
                <span>{item.label}</span>
                <Icon.ChevronRight size={15} />
              </a>
            );
          })}
        </nav>

        <div className="mobile-nav-bottom">
          {!isCapacitorNativeApp() && (
            <button
              type="button"
              className="mobile-nav-google-btn"
              onClick={handleMobileGoogleSignIn}
              disabled={googleLoading}
              aria-label="Sign in with Google for Livestock Owners"
            >
              <GoogleLogo size={18} />
              <span>{googleLoading ? "Connecting..." : "Sign in with Google"}</span>
            </button>
          )}

          <Link
            to="/login"
            className="mobile-nav-primary-btn"
            onClick={() => setMobileMenuOpen(false)}
          >
            <Icon.LogIn size={16} />
            <span>Access System</span>
          </Link>

          <Link
            to="/register"
            style={{
              textAlign: "center",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--lsmis-charcoal-600)",
              textDecoration: "none",
              paddingTop: 4,
            }}
            onClick={() => setMobileMenuOpen(false)}
          >
            New Livestock Owner? Register here
          </Link>
        </div>
      </div>

      {/* =========================================================
          2. HERO SECTION
          ========================================================= */}
      <section className="landing-hero landing-section" aria-label="Hero Introduction">
        {/* Large inspection photograph with dark forest green overlay */}
        <div className="hero-media-wrapper" aria-hidden="true">
          <img
            src={heroInspectorImg}
            alt="Meat Inspector inside City of Naga municipal slaughterhouse facility"
            className="hero-media-img"
            width="1376"
            height="768"
            fetchPriority="high"
            loading="eager"
            decoding="async"
          />
          <div className="hero-overlay-dark" />
        </div>

        <div className="landing-container">
          <div className="hero-content-inner">
            {/* Small Institutional Label */}
            <div className="hero-badge-pill">
              <span className="hero-badge-dot" />
              <span>City of Naga LSMIS</span>
            </div>

            {/* Main Headline */}
            <h1 className="hero-main-title">
              Modernizing Livestock Slaughter and <span>Meat Inspection</span>.
            </h1>

            {/* Description */}
            <p className="hero-lead-text">
              A centralized digital platform for managing livestock registration, slaughterhouse
              operations, veterinary inspections, carcass weighing, and meat permit records.
            </p>

            {/* Action Buttons */}
            <div className="hero-cta-group">
              <Link to="/login" className="btn-hero-primary">
                <span>Access System</span>
                <Icon.ArrowRight size={17} />
              </Link>
              <a
                href="#features"
                onClick={(e) => scrollToSection(e, "#features")}
                className="btn-hero-secondary"
              >
                <span>Explore Features</span>
              </a>
            </div>

            {/* Institutional Trust Badges */}
            <div className="hero-trust-chips">
              <div className="hero-chip-item">
                <Icon.ShieldCheck size={16} />
                <span>Class AA Abattoir Protocols</span>
              </div>
              <div className="hero-chip-item">
                <Icon.Stethoscope size={16} />
                <span>Certified Veterinary Oversight</span>
              </div>
              <div className="hero-chip-item">
                <Icon.Tag size={16} />
                <span>Complete Farm-to-Table Traceability</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          3. ABOUT SECTION
          ========================================================= */}
      <section className="landing-about landing-section" id="about" aria-label="About the System">
        <div className="landing-container">
          <div className="about-grid-layout">
            {/* Text Column */}
            <div className="about-text-content">
              <div>
                <span className="section-header-badge">Institutional Mandate</span>
                <h2 className="section-header-title">About the System</h2>
              </div>

              <p className="about-lead-paragraph">
                The Livestock Slaughter and Meat Inspection Management System (LSMIS) is the
                official municipal technology backbone operating at the City of Naga Slaughterhouse
                in Tinaan, City of Naga, Cebu.
              </p>

              <p className="about-body-paragraph">
                Administered under the Office of the City Veterinarian, LSMIS transforms municipal
                abattoir operations from manual logbooks to a secure, paperless management ecosystem.
                By verifying every animal upon arrival, supervising humane processing lines, and
                enforcing clinical examinations, the system ensures that only wholesome, disease-free
                meat reaches local markets and consumer tables in compliance with Republic Act No. 9296
                and Republic Act No. 10536.
              </p>

              <div className="about-highlights-list">
                <div className="about-highlight-card">
                  <div className="about-highlight-icon-box">
                    <Icon.ShieldCheck size={20} />
                  </div>
                  <div>
                    <h3 className="about-highlight-title">Safeguarding Public Food Safety</h3>
                    <p className="about-highlight-desc">
                      Mandatory ante-mortem screening and post-mortem pathological examinations
                      prevent diseased or contaminated meat from entering the municipal food supply.
                    </p>
                  </div>
                </div>

                <div className="about-highlight-card">
                  <div className="about-highlight-icon-box">
                    <Icon.Tag size={20} />
                  </div>
                  <div>
                    <h3 className="about-highlight-title">Full Animal Traceability</h3>
                    <p className="about-highlight-desc">
                      Every animal is cataloged with owner provenance, shipping credentials, and
                      ear tags from municipal lairage penning through final permit release.
                    </p>
                  </div>
                </div>

                <div className="about-highlight-card">
                  <div className="about-highlight-icon-box">
                    <Icon.Award size={20} />
                  </div>
                  <div>
                    <h3 className="about-highlight-title">Office of the City Veterinarian</h3>
                    <p className="about-highlight-desc">
                      Direct digital governance empowers licensed veterinarians to issue official
                      Meat Inspection Certificates (MIC) and transparent condemnation reports.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Supporting Photograph Column */}
            <div className="about-media-card">
              <img
                src={aboutVetImg}
                alt="City Veterinarian conducting an ante-mortem inspection of livestock"
                width="1376"
                height="768"
                loading="lazy"
                decoding="async"
              />
              <div className="about-media-caption">
                <span className="about-caption-text">
                  Veterinary Ante-Mortem Clinical Evaluation
                </span>
                <span className="about-caption-tag">Tinaan Facility</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          4. FEATURES SECTION
          ========================================================= */}
      <section className="landing-features landing-section" id="features" aria-label="System Features">
        <div className="landing-container">
          <div className="section-header-center">
            <span className="section-header-badge">Core Capabilities</span>
            <h2 className="section-header-title">Implemented System Modules</h2>
            <p className="section-header-desc">
              Dedicated operational modules engineered to streamline daily abattoir management,
              veterinary oversight, and compliance documentation:
            </p>
          </div>

          {/* 8 Implemented Modules Grid */}
          <div className="features-grid-container">
            {FEATURE_MODULES.map((feat) => (
              <div key={feat.title} className="feature-module-card">
                <div className="feature-card-icon-wrap">{feat.icon}</div>
                <h3 className="feature-card-name">{feat.title}</h3>
                <p className="feature-card-summary">{feat.desc}</p>
              </div>
            ))}
          </div>

          {/* Post-Mortem Examination Showcase Banner */}
          <div className="feature-showcase-banner">
            <div className="feature-showcase-photo-wrap">
              <img
                src={inspectionImg}
                alt="Veterinary Post-Mortem Carcass Examination in sanitized facility"
                width="1376"
                height="768"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="feature-showcase-content">
              <span className="section-header-badge">Veterinary Inspection Bay</span>
              <h3 className="feature-showcase-title">
                Rigorous Post-Mortem Pathological Scrutiny
              </h3>
              <p className="feature-showcase-text">
                Every dressed carcass undergoes systematic veterinary evaluation of the head,
                visceral internal organs, and carcass halves. The digital platform logs organ
                findings, condemnation evidence, and sanitary clearances in real time before
                carcasses proceed to certified weighing and stamping.
              </p>
              <div className="feature-showcase-badges">
                <span className="showcase-badge-pill">Head &amp; Lymph Node Examination</span>
                <span className="showcase-badge-pill">Visceral Organ Evaluation</span>
                <span className="showcase-badge-pill">Condemnation Evidence Logging</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          5. WORKFLOW SECTION
          ========================================================= */}
      <section className="landing-workflow landing-section" id="workflow" aria-label="Slaughterhouse Workflow">
        <div className="landing-container">
          <div className="section-header-center">
            <span className="section-header-badge">Operational Sequence</span>
            <h2 className="section-header-title">Slaughterhouse Workflow</h2>
            <p className="section-header-desc">
              The standardized 8-step sequential process enforced at the City of Naga
              Slaughterhouse, guaranteeing humane animal care and complete traceability:
            </p>
          </div>

          {/* Desktop Horizontal Timeline Grid */}
          <div className="workflow-desktop-timeline">
            {WORKFLOW_STEPS.map((step) => {
              const isVet = step.roleType === "vet";
              return (
                <div key={step.step} className="workflow-step-box">
                  <div className="workflow-step-header">
                    <span className="workflow-number-badge">{step.step}</span>
                    <span className={`workflow-actor-badge ${isVet ? "actor-vet" : "actor-staff"}`}>
                      {step.role}
                    </span>
                  </div>
                  <div className="workflow-step-icon">{step.icon}</div>
                  <h3 className="workflow-step-name">{step.title}</h3>
                  <p className="workflow-step-desc">{step.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Mobile Vertical Timeline */}
          <div className="workflow-mobile-timeline">
            {WORKFLOW_STEPS.map((step) => {
              const isVet = step.roleType === "vet";
              return (
                <div key={step.step} className="mobile-step-card">
                  <div className="mobile-step-left">
                    <span className="workflow-number-badge">{step.step}</span>
                  </div>
                  <div className="mobile-step-right">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span className={`workflow-actor-badge ${isVet ? "actor-vet" : "actor-staff"}`}>
                        {step.role}
                      </span>
                    </div>
                    <h3 className="workflow-step-name">{step.title}</h3>
                    <p className="workflow-step-desc">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* =========================================================
          6. CONTACT SECTION
          ========================================================= */}
      <section className="landing-contact landing-section" id="contact" aria-label="Contact and Facility Information">
        <div className="landing-container">
          <div className="contact-layout-box">
            {/* Official Facility & Office Details */}
            <div className="contact-info-col">
              <div>
                <span className="section-header-badge">Administration &amp; Inquiries</span>
                <h2 className="contact-office-title">Facility &amp; Administration</h2>
                <p className="contact-office-desc">
                  For intake scheduling, veterinary clearances, livestock registration, or slaughter
                  permit verifications, contact our abattoir administration office.
                </p>
              </div>

              <div className="contact-entries-grid">
                <div className="contact-entry-item">
                  <div className="contact-entry-icon">
                    <Icon.MapPin size={18} />
                  </div>
                  <div>
                    <div className="contact-entry-label">Facility Location</div>
                    <div className="contact-entry-val">
                      City of Naga Slaughterhouse<br />
                      Tinaan, City of Naga, Cebu, Philippines
                    </div>
                  </div>
                </div>

                <div className="contact-entry-item">
                  <div className="contact-entry-icon">
                    <Icon.Award size={18} />
                  </div>
                  <div>
                    <div className="contact-entry-label">Governing Office</div>
                    <div className="contact-entry-val">
                      Office of the City Veterinarian<br />
                      City Government of Naga, Cebu
                    </div>
                  </div>
                </div>

                <div className="contact-entry-item">
                  <div className="contact-entry-icon">
                    <Icon.Phone size={18} />
                  </div>
                  <div>
                    <div className="contact-entry-label">Operations Desk</div>
                    <div className="contact-entry-val">
                      <a href="tel:0322726655">(032) 272-6655</a>
                    </div>
                  </div>
                </div>

                <div className="contact-entry-item">
                  <div className="contact-entry-icon">
                    <Icon.Mail size={18} />
                  </div>
                  <div>
                    <div className="contact-entry-label">Official Email</div>
                    <div className="contact-entry-val">
                      <a href="mailto:cityvet@nagacitycebu.gov.ph">cityvet@nagacitycebu.gov.ph</a>
                    </div>
                  </div>
                </div>

                <div className="contact-entry-item" style={{ gridColumn: "1 / -1" }}>
                  <div className="contact-entry-icon">
                    <Icon.Clock size={18} />
                  </div>
                  <div>
                    <div className="contact-entry-label">Operating Schedule</div>
                    <div className="contact-entry-val">
                      Monday to Saturday: 4:00 AM – 6:00 PM (Lairage Intake &amp; Slaughter Operations)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Facility Photograph & Authorized Access Panel */}
            <div className="contact-media-col">
              <div className="contact-facility-img-wrap">
                <img
                  src={facilityBgImg}
                  alt="City of Naga Municipal Slaughterhouse facility exterior"
                  width="1024"
                  height="575"
                  loading="lazy"
                  decoding="async"
                />
                <div className="contact-facility-img-overlay" />
              </div>

              <div className="contact-portal-box">
                <span className="contact-portal-badge">Authorized Access</span>
                <h3 className="contact-portal-title">Official System Portal</h3>
                <p className="contact-portal-desc">
                  Licensed veterinarians, slaughterhouse personnel, and registered livestock owners
                  may sign in to access their assigned modules and records.
                </p>
                <Link to="/login" className="btn-contact-login">
                  <Icon.LogIn size={16} />
                  <span>Access System</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          7. FOOTER
          ========================================================= */}
      <footer className="landing-footer" role="contentinfo">
        <div className="landing-container">
          <div className="footer-top-grid">
            {/* Brand & Seals */}
            <div className="footer-brand-box">
              <div className="footer-seals-row">
                <div className="footer-seal-item" title="City of Naga Official Seal">
                  <img src="/naga_city_seal.png" alt="City of Naga Seal" width="40" height="40" />
                </div>
                <div className="footer-seal-item" title="LSMIS Official Seal">
                  <img src={logoImg} alt="LSMIS Official Seal" width="40" height="40" />
                </div>
                <div className="footer-seal-item" title="Bagong Pilipinas Official Seal">
                  <img src="/bagong_pilipinas.png" alt="Bagong Pilipinas Seal" width="40" height="40" />
                </div>
              </div>

              <h4 className="footer-brand-heading">LSMIS · City of Naga</h4>
              <div className="footer-brand-subheading">
                Livestock Slaughter and Meat Inspection Management System
              </div>
              <p className="footer-brand-summary">
                A dedicated municipal governance technology standardizing livestock intake,
                humane abattoir operations, veterinary inspections, and sanitary meat permitting
                in Tinaan, City of Naga, Cebu, Philippines.
              </p>
            </div>

            {/* Quick Navigation */}
            <div>
              <h5 className="footer-col-title">Navigation</h5>
              <ul className="footer-links-list">
                {NAV_ITEMS.map((item) => (
                  <li key={item.label}>
                    <a href={item.href} onClick={(e) => scrollToSection(e, item.href)}>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Statutory Standards */}
            <div>
              <h5 className="footer-col-title">Statutory Mandates</h5>
              <ul className="footer-links-list">
                <li><span>Republic Act No. 9296</span></li>
                <li><span>Republic Act No. 10536</span></li>
                <li><span>NMIS Class AA Standards</span></li>
                <li><span>City of Naga Revenue Code</span></li>
              </ul>
            </div>

            {/* Office & Facility */}
            <div>
              <h5 className="footer-col-title">Administration</h5>
              <ul className="footer-links-list">
                <li><span>Office of the City Veterinarian</span></li>
                <li><span>City of Naga Slaughterhouse</span></li>
                <li><span>Tinaan, City of Naga, Cebu</span></li>
                <li><a href="tel:0322726655">(032) 272-6655</a></li>
                <li><a href="mailto:cityvet@nagacitycebu.gov.ph">cityvet@nagacitycebu.gov.ph</a></li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar: Copyright, Illustrative Disclaimer & Back to Top */}
          <div className="footer-bottom-bar">
            <div>
              <div>
                &copy; {new Date().getFullYear()} City Government of Naga, Cebu · Office of the City
                Veterinarian. All rights reserved.
              </div>
              <div className="footer-bottom-notice">
                Photographic imagery depicting inspection procedures and abattoir operations are
                illustrative representations for this information portal.
              </div>
            </div>

            <button
              type="button"
              className="footer-back-to-top"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label="Back to top of page"
            >
              <span>Back to Top</span>
              <Icon.ChevronUp size={14} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
