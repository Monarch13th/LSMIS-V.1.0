import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/icons";
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
    desc: "Record animal intake, owner details, origin, and pen assignments.",
    icon: <Icon.Cow size={22} />,
  },
  {
    title: "Animal Marking",
    desc: "Assign official ear tags and identification marks for animal tracking.",
    icon: <Icon.Tag size={22} />,
  },
  {
    title: "Ante-Mortem Inspection",
    desc: "Document clinical evaluations of live animals before slaughter.",
    icon: <Icon.Stethoscope size={22} />,
  },
  {
    title: "Slaughter Operations",
    desc: "Monitor operational stages from stunning to final carcass preparation.",
    icon: <Icon.Activity size={22} />,
  },
  {
    title: "Post-Mortem Inspection",
    desc: "Record examination results for visceral organs and dressed carcasses.",
    icon: <Icon.ClipboardCheck size={22} />,
  },
  {
    title: "Carcass Weighing",
    desc: "Log verified carcass weights and official sanitary brand codes.",
    icon: <Icon.Scale size={22} />,
  },
  {
    title: "Meat Permits",
    desc: "Issue verified meat inspection permits and gate clearances.",
    icon: <Icon.FileText size={22} />,
  },
  {
    title: "Reports & Audit Logs",
    desc: "Maintain searchable operational logs, daily summaries, and activity records.",
    icon: <Icon.Report size={22} />,
  },
];

const WORKFLOW_STEPS = [
  {
    step: 1,
    title: "Livestock Registration",
    role: "Staff",
    roleType: "staff",
    desc: "Record owner details, animal count, origin, and pen allocation.",
    icon: <Icon.Cow size={18} />,
  },
  {
    step: 2,
    title: "Animal Marking",
    role: "Staff",
    roleType: "staff",
    desc: "Apply official ear tags and lot numbers for traceability.",
    icon: <Icon.Tag size={18} />,
  },
  {
    step: 3,
    title: "Ante-Mortem Inspection",
    role: "Veterinarian",
    roleType: "vet",
    desc: "Examine live animals to verify fitness for slaughter.",
    icon: <Icon.Stethoscope size={18} />,
  },
  {
    step: 4,
    title: "Team Assignment",
    role: "Staff",
    roleType: "staff",
    desc: "Assign abattoir processing teams to approved animals.",
    icon: <Icon.Users size={18} />,
  },
  {
    step: 5,
    title: "Ready for Slaughter",
    role: "Staff",
    roleType: "staff",
    desc: "Process approved animals through standard slaughter stages.",
    icon: <Icon.Scissors size={18} />,
  },
  {
    step: 6,
    title: "Post-Mortem Inspection",
    role: "Veterinarian",
    roleType: "vet",
    desc: "Inspect internal organs and carcass halves for consumption safety.",
    icon: <Icon.ClipboardCheck size={18} />,
  },
  {
    step: 7,
    title: "Carcass Weighing",
    role: "Veterinarian",
    roleType: "vet",
    desc: "Capture certified carcass weights and brand numbers.",
    icon: <Icon.Scale size={18} />,
  },
  {
    step: 8,
    title: "Meat Permit",
    role: "Staff",
    roleType: "staff",
    desc: "Issue verified meat inspection permits and gate passes.",
    icon: <Icon.FileText size={18} />,
  },
];

export const LandingPage = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("top");
  const [googleLoading, setGoogleLoading] = useState(false);
  const mobileMenuRef = useRef(null);

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
                <span className="nav-brand-sub">City of Naga - Slaughterhouse</span>
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

            {/* Nav Actions: Register, Login, Mobile Toggle */}
            <div className="nav-actions">
              <Link to="/register" className="nav-btn-register" aria-label="Register Owner Account">
                <Icon.UserPlus size={15} />
                <span>Register</span>
              </Link>

              <Link to="/login" className="nav-btn-login" aria-label="Login">
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
              LSMIS
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
            alt="Meat inspection inside the facility"
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
              <span>Tinaan, City of Naga, Cebu</span>
            </div>

            {/* Main Headline */}
            <h1 className="hero-main-title">
              Modernizing Livestock <br className="hero-title-br" />Slaughter and Meat Inspection
            </h1>

            {/* Description */}
            <p className="hero-lead-text">
              A digital system for managing livestock registration, inspections, slaughter operations, and meat permits.
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
                <Icon.CheckCircle size={16} />
                <span>Verified Inspection Protocols</span>
              </div>
              <div className="hero-chip-item">
                <Icon.Stethoscope size={16} />
                <span>Veterinary Oversight</span>
              </div>
              <div className="hero-chip-item">
                <Icon.Tag size={16} />
                <span>Livestock Traceability</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          3. ABOUT SECTION (Single-Frame Responsive Fit)
          ========================================================= */}
      <section className="landing-about landing-section" id="about" aria-label="About the System">
        <div className="landing-container">
          <div className="about-grid-layout">
            {/* Text Column */}
            <div className="about-text-content">
              <div className="about-header-wrap">
                <span className="section-header-badge">System Overview</span>
                <h2 className="section-header-title">About the System</h2>
              </div>

              <p className="about-lead-paragraph">
                The Livestock Slaughter and Meat Inspection Management System (LSMIS) is the City of Naga&apos;s digital platform replacing manual logbooks with secure tracking from animal intake through veterinary inspections, humane slaughter, carcass weighing, and certified permit issuance.
              </p>

              <div className="about-highlights-list">
                <div className="about-highlight-card">
                  <div className="about-highlight-icon-box">
                    <Icon.ShieldCheck size={18} />
                  </div>
                  <div className="about-highlight-body">
                    <h3 className="about-highlight-title">Inspection Management</h3>
                    <p className="about-highlight-desc">
                      Real-time ante-mortem health screenings and post-mortem pathological evaluations.
                    </p>
                  </div>
                </div>

                <div className="about-highlight-card">
                  <div className="about-highlight-icon-box">
                    <Icon.Tag size={18} />
                  </div>
                  <div className="about-highlight-body">
                    <h3 className="about-highlight-title">Livestock Tracking</h3>
                    <p className="about-highlight-desc">
                      Intake registration, official ear tag assignments, and pen allocations.
                    </p>
                  </div>
                </div>

                <div className="about-highlight-card">
                  <div className="about-highlight-icon-box">
                    <Icon.FileText size={18} />
                  </div>
                  <div className="about-highlight-body">
                    <h3 className="about-highlight-title">Permits &amp; Weights</h3>
                    <p className="about-highlight-desc">
                      Certified carcass weight records and official meat inspection certificates.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Supporting Photograph Column */}
            <div className="about-media-card">
              <img
                src={aboutVetImg}
                alt="Ante-mortem inspection of livestock"
                width="1376"
                height="768"
                loading="lazy"
                decoding="async"
              />
              <div className="about-media-caption">
                <span className="about-caption-text">
                  Ante-Mortem Clinical Evaluation
                </span>
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
            <span className="section-header-badge">Core Modules</span>
            <h2 className="section-header-title">System Features</h2>
            <p className="section-header-desc">
              Key operational modules implemented to manage livestock records, inspections, and permits:
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
                alt="Post-mortem carcass examination"
                width="1376"
                height="768"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="feature-showcase-content">
              <span className="section-header-badge">Inspection Process</span>
              <h3 className="feature-showcase-title">
                Post-Mortem Examination
              </h3>
              <p className="feature-showcase-text">
                Dressed carcasses and visceral organs undergo systematic veterinary evaluation.
                The system records examination findings, condemnation details, and sanitary clearances
                before carcasses proceed to certified weighing.
              </p>
              <div className="feature-showcase-badges">
                <span className="showcase-badge-pill">Head &amp; Organ Examination</span>
                <span className="showcase-badge-pill">Condemnation Logging</span>
                <span className="showcase-badge-pill">Sanitary Clearance</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          5. WORKFLOW SECTION
          ========================================================= */}
      <section className="landing-workflow landing-section" id="workflow" aria-label="System Workflow">
        <div className="landing-container">
          <div className="section-header-center">
            <span className="section-header-badge">Sequential Process</span>
            <h2 className="section-header-title">System Workflow</h2>
            <p className="section-header-desc">
              The eight-stage operational workflow enforced across the platform:
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
      <section className="landing-contact landing-section" id="contact" aria-label="Contact Information">
        <div className="landing-container">
          <div className="contact-layout-box">
            {/* Official Facility & Office Details */}
            <div className="contact-info-col">
              <div>
                <span className="section-header-badge">Inquiries &amp; Support</span>
                <h2 className="contact-office-title">Contact Information</h2>
                <p className="contact-office-desc">
                  For system inquiries, account support, or permit verification, reach out through the verified contact channels below.
                </p>
              </div>

              <div className="contact-entries-grid">
                <div className="contact-entry-item">
                  <div className="contact-entry-icon">
                    <Icon.MapPin size={18} />
                  </div>
                  <div>
                    <div className="contact-entry-label">Location</div>
                    <div className="contact-entry-val">
                      Tinaan, City of Naga, Cebu
                    </div>
                  </div>
                </div>

                <div className="contact-entry-item">
                  <div className="contact-entry-icon">
                    <Icon.Phone size={18} />
                  </div>
                  <div>
                    <div className="contact-entry-label">Telephone</div>
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

                <div className="contact-entry-item">
                  <div className="contact-entry-icon">
                    <Icon.Clock size={18} />
                  </div>
                  <div>
                    <div className="contact-entry-label">Operating Schedule</div>
                    <div className="contact-entry-val">
                      Monday to Saturday: 4:00 AM – 6:00 PM
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
                  alt="Facility in Tinaan, City of Naga, Cebu"
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
                  Authorized personnel and registered livestock owners may sign in to access their assigned modules and records.
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
          7. PROFESSIONAL LSMIS MUNICIPAL FOOTER
          ========================================================= */}
      <footer className="landing-footer" role="contentinfo">
        <h2 className="footer-sr-only">Footer Information and System Directory</h2>
        <div className="landing-container">
          <div className="footer-grid">
            {/* Column 1: LSMIS Municipal Identity */}
            <div className="footer-col footer-col-brand">
              <div className="footer-brand-header">
                <img
                  src={logoImg}
                  alt="City of Naga LSMIS Official Seal"
                  width="48"
                  height="48"
                  className="footer-brand-logo"
                />
                <div className="footer-brand-titles">
                  <h3 className="footer-brand-name">LSMIS · City of Naga</h3>
                  <span className="footer-brand-dept">Office of the City Veterinarian</span>
                </div>
              </div>
              <p className="footer-brand-location">
                <Icon.MapPin size={15} aria-hidden="true" />
                <span>Tinaan, City of Naga</span>
              </p>
              <p className="footer-brand-desc">
                The Livestock Slaughter and Meat Inspection Management System (LSMIS) is the City of Naga&apos;s digital platform for animal receiving, ante-mortem and post-mortem inspections, humane slaughter operations, carcass weighing, and meat permit issuance.
              </p>
            </div>

            {/* Column 2: LSMIS Abattoir Modules */}
            <div className="footer-col footer-col-modules">
              <h4 className="footer-col-heading">System Modules</h4>
              <ul className="footer-links-list">
                <li>
                  <a href="#features" onClick={(e) => scrollToSection(e, "#features")} className="footer-link-item">
                    <Icon.ChevronRight size={13} aria-hidden="true" />
                    <span>Livestock Registration &amp; Receiving</span>
                  </a>
                </li>
                <li>
                  <a href="#features" onClick={(e) => scrollToSection(e, "#features")} className="footer-link-item">
                    <Icon.ChevronRight size={13} aria-hidden="true" />
                    <span>Official Animal Marking &amp; Tagging</span>
                  </a>
                </li>
                <li>
                  <a href="#features" onClick={(e) => scrollToSection(e, "#features")} className="footer-link-item">
                    <Icon.ChevronRight size={13} aria-hidden="true" />
                    <span>Ante-Mortem Veterinary Inspection</span>
                  </a>
                </li>
                <li>
                  <a href="#workflow" onClick={(e) => scrollToSection(e, "#workflow")} className="footer-link-item">
                    <Icon.ChevronRight size={13} aria-hidden="true" />
                    <span>Humane Slaughter Processing</span>
                  </a>
                </li>
                <li>
                  <a href="#features" onClick={(e) => scrollToSection(e, "#features")} className="footer-link-item">
                    <Icon.ChevronRight size={13} aria-hidden="true" />
                    <span>Post-Mortem Carcass Inspection</span>
                  </a>
                </li>
                <li>
                  <a href="#features" onClick={(e) => scrollToSection(e, "#features")} className="footer-link-item">
                    <Icon.ChevronRight size={13} aria-hidden="true" />
                    <span>Carcass Weighing &amp; Records</span>
                  </a>
                </li>
                <li>
                  <a href="#workflow" onClick={(e) => scrollToSection(e, "#workflow")} className="footer-link-item">
                    <Icon.ChevronRight size={13} aria-hidden="true" />
                    <span>Meat Inspection Certificate (MIC)</span>
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 3: Legal Mandates & Regulations */}
            <div className="footer-col footer-col-legal">
              <h4 className="footer-col-heading">Legal Mandates</h4>
              <ul className="footer-links-list">
                <li>
                  <a
                    href="https://www.officialgazette.gov.ph/2004/05/12/republic-act-no-9296/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="footer-link-item"
                    title="Republic Act No. 9296 on Official Gazette (opens in a new tab)"
                  >
                    <span>Republic Act No. 9296</span>
                    <span className="footer-link-sub">Meat Inspection Code of the Philippines</span>
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.officialgazette.gov.ph/2013/05/15/republic-act-no-10536/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="footer-link-item"
                    title="Republic Act No. 10536 on Official Gazette (opens in a new tab)"
                  >
                    <span>Republic Act No. 10536</span>
                    <span className="footer-link-sub">Strengthening Meat Inspection (Amending RA 9296)</span>
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.officialgazette.gov.ph/2013/08/23/republic-act-no-10611/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="footer-link-item"
                    title="Republic Act No. 10611 on Official Gazette (opens in a new tab)"
                  >
                    <span>Republic Act No. 10611</span>
                    <span className="footer-link-sub">Food Safety Act of 2013</span>
                  </a>
                </li>
                <li>
                  <a
                    href="https://nmis.gov.ph"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="footer-link-item"
                    title="Department of Agriculture Circular No. 01, Series of 2014 on NMIS (opens in a new tab)"
                  >
                    <span>DA Department Circular No. 01, s. 2014</span>
                    <span className="footer-link-sub">Revised IRR of RA 9296, as amended</span>
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 4: Facility & Operations Contact */}
            <div className="footer-col footer-col-contact">
              <h4 className="footer-col-heading">Facility Operations</h4>
              <div className="footer-contact-block">
                <div className="footer-schedule-item">
                  <span className="footer-sched-label">Livestock Receiving:</span>
                  <span className="footer-sched-val">24/7 Receiving Operations</span>
                </div>
                <div className="footer-schedule-item">
                  <span className="footer-sched-label">Veterinary Inspection:</span>
                  <span className="footer-sched-val">4:00 AM – 6:00 PM Daily</span>
                </div>
              </div>

              <div className="footer-contact-links">
                <a href="tel:0322726655" className="footer-contact-item" title="Call City Veterinarian Office">
                  <Icon.Phone size={14} aria-hidden="true" />
                  <span>(032) 272-6655</span>
                </a>
                <a href="mailto:cityvet@nagacitycebu.gov.ph" className="footer-contact-item" title="Email City Veterinarian Office">
                  <Icon.Mail size={14} aria-hidden="true" />
                  <span>cityvet@nagacitycebu.gov.ph</span>
                </a>
              </div>
            </div>
          </div>

          {/* Bottom Bar: Divider & Dynamic Year Copyright */}
          <div className="footer-bottom-bar">
            <p className="footer-copyright">
              &copy; {new Date().getFullYear()} LSMIS &ndash; Livestock Slaughter and Meat Inspection Management System · City Government of Naga, Cebu. All rights reserved.
            </p>
            <div className="footer-bottom-meta">
              <Icon.MapPin size={13} aria-hidden="true" />
              <span>Tinaan, City of Naga</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
