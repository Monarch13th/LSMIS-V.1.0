import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Icon } from "../components/icons";
import { useTheme } from "../hooks/useTheme";
import { useAuth } from "../hooks/useAuth";
import { ownerAuthService } from "../services/ownerAuthService";
import { isCapacitorNativeApp, isInstalledApp } from "../utils/capacitor";
import logoImg from "../assets/logo.jpg";
import facilityBgImg from "../assets/lsmis-facility-bg.jpg";

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

const navLinks = [
  { label: "Home", href: "#top" },
  { label: "About", href: "#about" },
  { label: "Features", href: "#features" },
  { label: "Workflow", href: "#workflow" },
  { label: "Contact", href: "#contact" },
];

const featureCards = [
  {
    title: "Livestock Management",
    desc: "Manage owner records, livestock profiles, and track status from intake to final release.",
    icon: <Icon.Cow size={20} />,
    tag: "Intake & Penning",
    items: [
      "Owner & provenance registration",
      "Lairage ear tag assignment",
      "Real-time pen allocation",
    ],
  },
  {
    title: "Meat Inspection",
    desc: "Record Ante-Mortem screening and Post-Mortem examinations with clinical precision.",
    icon: <Icon.Stethoscope size={20} />,
    tag: "Clinical Exam",
    items: [
      "Clinical ante-mortem screening",
      "Post-mortem carcass evaluation",
      "Condemnation & disposal logging",
    ],
  },
  {
    title: "Slaughter Management",
    desc: "Track humane slaughter lines, scale weights, and sanitary dispatch gate-pass clearance.",
    icon: <Icon.Activity size={20} />,
    tag: "Processing",
    items: [
      "Humane processing line logs",
      "Digital carcass scale recording",
      "Sanitary gate-pass clearance",
    ],
  },
  {
    title: "Records and Reports",
    desc: "Generate Meat Inspection Certificates (MIC) and tamper-proof compliance audits.",
    icon: <Icon.ClipboardCheck size={20} />,
    tag: "Compliance",
    items: [
      "Official Meat Inspection Certificates",
      "Standardized inspection reporting",
      "Traceability & slaughter logs",
    ],
  },
];

const workflowSteps = [
  {
    step: 1,
    title: "Receiving",
    role: "Slaughterhouse Staff",
    desc: "Intake verification of certificates, farm origin, and pen assignment.",
    icon: <Icon.Truck size={17} />,
  },
  {
    step: 2,
    title: "Animal Marking",
    role: "Slaughterhouse Staff",
    desc: "Official Ear Tag or Tattoo marking and serial lot assignment.",
    icon: <Icon.Tag size={17} />,
  },
  {
    step: 3,
    title: "Ante-Mortem Inspection",
    role: "Veterinary Inspector",
    desc: "Clinical veterinary examination and screening for slaughter fitness.",
    icon: <Icon.Stethoscope size={17} />,
  },
  {
    step: 4,
    title: "Slaughter Processing",
    role: "Slaughterhouse Staff",
    desc: "Humane stunning, bleeding, scalding, and evisceration.",
    icon: <Icon.Scissors size={17} />,
  },
  {
    step: 5,
    title: "Post-Mortem Inspection",
    role: "Veterinary Inspector",
    desc: "Pathological exam of head, internal organs, and carcass halves.",
    icon: <Icon.ClipboardCheck size={17} />,
  },
  {
    step: 6,
    title: "Carcass Weighing",
    role: "Veterinary Inspector",
    desc: "Digital scale weighing of warm carcass, branding, and grading.",
    icon: <Icon.Scale size={17} />,
  },
  {
    step: 7,
    title: "Meat Permit",
    role: "Slaughterhouse Staff",
    desc: "Issuance of official Meat Inspection Certificate (MIC) and permits.",
    icon: <Icon.FileText size={17} />,
  },
];



export const LandingPage = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { role, isAuthenticated, loading: authLoading, isInitialized: authInitialized } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // If running inside the installed APK or installed PWA, bypass the landing page directly
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

  // On-scroll navbar height and shadow reduction
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Keyboard accessibility for mobile drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  // Lock body scroll when mobile menu drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  // Subtle scroll-reveal observer (lightweight, zero-dependency, non-flickering)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const prefersReducedMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!("IntersectionObserver" in window) || prefersReducedMotion) {
      // Respect reduced motion or fallback by leaving items immediately visible
      return;
    }

    // Enable CSS animation classes only when active
    document.documentElement.classList.add("js-anim");

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            // Animate entrance once to prevent repeated flickering during scrolling
            obs.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -30px 0px",
      }
    );

    const animTargets = document.querySelectorAll(
      ".scroll-reveal, .stagger-group"
    );
    animTargets.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("js-anim");
    };
  }, []);

  const scrollToSection = (e, href) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const targetId = href.replace("#", "");
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="landing-page" id="top">
      {/* Main Header with Sticky Nav & Scroll Feedback */}
      <header className={`landing-header ${isScrolled ? "scrolled" : ""}`}>
        <div className="container landing-nav">
          <Link to="/" className="landing-brand">
            <div className="landing-logo">
              <img src={logoImg} alt="LSMIS Official Logo" />
            </div>
            <div className="landing-brand-text">
              <span className="landing-brand-title">LSMIS</span>
              <span className="landing-brand-sub">Tinaan, City of Naga, Cebu, Philippines</span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="landing-nav-links" aria-label="Main Navigation">
            {navLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={(e) => scrollToSection(e, item.href)}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Nav Actions: Dark Mode Toggle, Login & Register CTAs */}
          <div className="landing-nav-actions">
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
            </button>

            <Link to="/login" className="btn-login-nav">
              <Icon.LogIn size={14} />
              <span>Login</span>
            </Link>

            <Link to="/register" className="btn-signin-nav">
              <Icon.UserPlus size={14} />
              <span>Register</span>
            </Link>

            <button
              type="button"
              className="mobile-nav-toggle"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <Icon.X size={20} /> : <Icon.Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Nav Backdrop Overlay */}
        {mobileMenuOpen && (
          <div
            className="mobile-nav-overlay"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Mobile Nav Drawer */}
        <div className={`mobile-nav-drawer ${mobileMenuOpen ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Mobile Navigation Menu">
          <div className="mobile-nav-header">
            <span className="mobile-nav-title">Menu</span>
            <button
              type="button"
              className="mobile-nav-close"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close menu"
            >
              <Icon.X size={18} />
            </button>
          </div>
          <div className="mobile-nav-items">
            {navLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={(e) => scrollToSection(e, item.href)}
              >
                {item.label}
              </a>
            ))}
          </div>
          <div className="mobile-nav-footer">
            <div className="mobile-nav-theme-row">
              <span className="mobile-nav-theme-label">Theme Mode</span>
              <button
                type="button"
                className="theme-toggle-btn"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <><Icon.Sun size={16} /> Light</> : <><Icon.Moon size={16} /> Dark</>}
              </button>
            </div>
            {!isCapacitorNativeApp() && (<div className="mobile-nav-owner-google-wrap">
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
            </div> )}
            <div className="mobile-nav-auth-actions">
              <Link
                to="/login"
                className="mobile-nav-login-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon.LogIn size={15} />
                <span>Login</span>
              </Link>
              <Link
                to="/register"
                className="mobile-nav-signin-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon.UserPlus size={15} />
                <span>Register</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section with Official Facility Background */}
      <section className="hero-section" id="home">
        {/* Livestock Inspection Facility Background Layer */}
        <div className="hero-backdrop" aria-hidden="true">
          <img
            src={facilityBgImg}
            alt=""
            className="hero-backdrop-img"
            fetchPriority="high"
            loading="eager"
            decoding="async"
          />
          <div className="hero-backdrop-overlay" />
        </div>

        <div className="container hero-centered-container">
          <div className="hero-content-card scroll-reveal">
            {/* Required Bold Primary Headline */}
            <h1 className="hero-headline">
              Livestock Slaughter and <span className="headline-gov-teal">Meat Inspection</span> Management System
            </h1>

            {/* Required Supporting Subheadline */}
            <p className="hero-subtext">
              A web-based system for managing livestock records, slaughter operations, meat inspections, permits, and related abattoir records.
            </p>

            {/* Hero Action Buttons */}
            <div className="hero-actions">
              <Link to="/login" className="btn-hero-primary">
                <span>Login to System</span>
              </Link>
              <a
                href="#about"
                className="btn-hero-secondary"
                onClick={(e) => scrollToSection(e, "#about")}
              >
                <span>Learn More</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="about-section" id="about">
        <div className="container">
          <div className="section-header scroll-reveal">
            <span className="section-tag">Institutional Mandate</span>
            <h2 className="section-title">About the System</h2>
            <p className="section-subtitle">
              The Livestock Slaughter and Meat Inspection Management System (LSMIS) is a municipal technology platform developed specifically for Tinaan, City of Naga, Cebu, Philippines.
            </p>
          </div>

          <div className="about-intro-box scroll-reveal">
            <div className="about-intro-col">
              <h4>Modernizing Veterinary Oversight</h4>
              <p>
                LSMIS supports abattoir operations by centralizing livestock receiving, lairage monitoring, ante-mortem and post-mortem clinical inspections, slaughter operations, digital carcass weighing, and permit issuance into an integrated, paperless system.
              </p>
            </div>
            <div className="about-intro-col">
              <h4>Safeguarding Public Health</h4>
              <p>
                Operating at the municipal slaughterhouse facility in Tinaan, City of Naga, Cebu, Philippines, the platform guarantees that every animal entering the slaughterhouse is clinically evaluated by licensed veterinarians, slaughtered humanely, and inspected pathologically so that only clean, wholesome, disease-free meat reaches consumer tables.
              </p>
            </div>
          </div>

          <div className="core-focus-header scroll-reveal">
            <h3>Key Institutional Mandates</h3>
            <p>Four primary pillars governing slaughterhouse operations in Tinaan, City of Naga, Cebu, Philippines:</p>
          </div>

          <div className="core-focus-grid stagger-group">
            <div className="core-focus-card scroll-reveal-child">
              <div className="core-focus-icon-box"><Icon.Cow size={20} /></div>
              <h4>Complete Animal Traceability</h4>
              <p>Digital encoding of farm origin, owner credentials, shipping permits, and food-grade ear tagging upon arrival at municipal lairage pens.</p>
            </div>
            <div className="core-focus-card scroll-reveal-child">
              <div className="core-focus-icon-box"><Icon.Stethoscope size={20} /></div>
              <h4>Rigorous Veterinary Inspection</h4>
              <p>Mandatory clinical screening by licensed City Veterinarians, ensuring suspect or diseased livestock are immediately quarantined or condemned.</p>
            </div>
            <div className="core-focus-card scroll-reveal-child">
              <div className="core-focus-icon-box"><Icon.Shield size={20} /></div>
              <h4>Statutory Food Safety Standards</h4>
              <p>Full compliance with the Meat Inspection Code of the Philippines (RA 9296 / RA 10536) and NMIS Class AA sanitary protocols.</p>
            </div>
            <div className="core-focus-card scroll-reveal-child">
              <div className="core-focus-icon-box"><Icon.FileText size={20} /></div>
              <h4>Official Permitting &amp; Clearance</h4>
              <p>Immediate generation of Meat Inspection Certificates (MIC) and gate clearances, ensuring accredited meat reaches consumers safely.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section: 4 Core Feature Cards */}
      <section className="features-section" id="features">
        <div className="container">
          <div className="section-header scroll-reveal">
            <span className="section-tag">Core Modules</span>
            <h2 className="section-title">System Features</h2>
            <p className="section-subtitle">
              Comprehensive capabilities designed to streamline end-to-end slaughterhouse operations for veterinarians, staff, and livestock owners.
            </p>
          </div>

          <div className="features-grid stagger-group">
            {featureCards.map((feat) => (
              <div key={feat.title} className="feature-card scroll-reveal-child">
                <div className="feature-card-header">
                  <div className="feature-card-icon">{feat.icon}</div>
                  <span className="feature-card-tag">{feat.tag}</span>
                </div>
                <h3 className="feature-card-title">{feat.title}</h3>
                <p className="feature-card-desc">{feat.desc}</p>
                <ul className="feature-card-list">
                  {feat.items.map((item, idx) => (
                    <li key={idx}>
                      <Icon.Check size={12} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow Section: 7-Step Sequential Process Timeline */}
      <section className="workflow-section" id="workflow">
        <div className="container">
          <div className="section-header scroll-reveal">
            <span className="section-tag">Operational Sequence</span>
            <h2 className="section-title">Slaughterhouse Workflow</h2>
            <p className="section-subtitle">
              A standardized 7-step timeline ensuring complete traceability, humane animal treatment, and rigorous veterinary scrutiny at each physical station.
            </p>
          </div>

          <div className="workflow-timeline stagger-group">
            {workflowSteps.map((step, index) => {
              const isVet = step.role.toLowerCase().includes("vet");
              return (
                <div key={step.step} className="workflow-step-card scroll-reveal-child">
                  <div className="workflow-step-top">
                    <div className="step-badge">Step {step.step}</div>
                    <span className={`step-role-badge ${isVet ? "role-vet" : "role-staff"}`}>
                      {step.role}
                    </span>
                  </div>
                  <div className={`workflow-step-icon ${isVet ? "icon-vet" : "icon-staff"}`}>
                    {step.icon}
                  </div>
                  <h4 className="workflow-step-title">{step.title}</h4>
                  <p className="workflow-step-desc">{step.desc}</p>
                  {index < workflowSteps.length - 1 && (
                    <div className="workflow-connector" aria-hidden="true">
                      <Icon.ArrowRight size={16} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contact Section: Tinaan, City of Naga, Cebu, Philippines */}
      <section className="contact-section" id="contact">
        <div className="container">
          <div className="contact-box scroll-reveal">
            <div className="contact-info">
              <span className="section-tag">Facility &amp; Support</span>
              <h3>City Abattoir Administration</h3>
              <p>
                For livestock intake scheduling, veterinary clearances, meat inspection permits, or administrative inquiries, visit or contact our abattoir administration office.
              </p>

              <div className="contact-details-grid">
                <div className="contact-detail-item">
                  <span className="contact-detail-icon"><Icon.MapPin size={18} /></span>
                  <div>
                    <h5>Facility Location</h5>
                    <span>Tinaan, City of Naga, Cebu, Philippines</span>
                  </div>
                </div>
                <div className="contact-detail-item">
                  <span className="contact-detail-icon"><Icon.Phone size={18} /></span>
                  <div>
                    <h5>Operations Desk</h5>
                    <span>(032) 272-6655</span>
                  </div>
                </div>
                <div className="contact-detail-item">
                  <span className="contact-detail-icon"><Icon.Mail size={18} /></span>
                  <div>
                    <h5>Official Email</h5>
                    <a href="mailto:cityvet@nagacitycebu.gov.ph">cityvet@nagacitycebu.gov.ph</a>
                  </div>
                </div>
                <div className="contact-detail-item">
                  <span className="contact-detail-icon"><Icon.Clock size={18} /></span>
                  <div>
                    <h5>Operating Hours</h5>
                    <span>Monday – Saturday: 4:00 AM – 6:00 PM</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="contact-action-panel">
              <h4>Authorized System Access</h4>
              <p>
                Licensed veterinarians, slaughterhouse personnel, and registered livestock owners may sign in to access their assigned workspaces.
              </p>
              <Link
                to="/login"
                className="btn-contact-signin"
              >
                <span>Login to System</span>
                <Icon.ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer scroll-reveal">
        <div className="container">
          <div className="landing-footer-grid">
            <div className="footer-brand">
              <div className="footer-logo-row">
                <div className="footer-logo">
                  <img src={logoImg} alt="LSMIS Official Seal" />
                </div>
                <div>
                  <h4>LSMIS</h4>
                  <span className="footer-brand-sub">City of Naga, Cebu</span>
                </div>
              </div>
              <p>
                Livestock Slaughter and Meat Inspection Management System (LSMIS). Standardizing municipal abattoir operations and ensuring wholesome meat food safety.
              </p>
              <div className="footer-status-pill">
                <span className="footer-status-dot" />
                <span>Operational · Tinaan, City of Naga, Cebu, Philippines</span>
              </div>
            </div>

            <div className="footer-col">
              <h5>Quick Navigation</h5>
              <ul>
                {navLinks.map((item) => (
                  <li key={item.label}>
                    <a href={item.href} onClick={(e) => scrollToSection(e, item.href)}>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="footer-col">
              <h5>Statutory Standards</h5>
              <ul>
                <li><span>Republic Act No. 9296</span></li>
                <li><span>Republic Act No. 10536</span></li>
                <li><span>NMIS Class AA Standards</span></li>
                <li><span>City of Naga Revenue Code</span></li>
              </ul>
            </div>

            <div className="footer-col">
              <h5>Contact &amp; Support</h5>
              <ul>
                <li><span>City Abattoir Complex</span></li>
                <li><span>Tinaan, City of Naga, Cebu, Philippines</span></li>
                <li><span>Tel: (032) 272-6655</span></li>
                <li><a href="mailto:cityvet@nagacitycebu.gov.ph">cityvet@nagacitycebu.gov.ph</a></li>
              </ul>
            </div>
          </div>

          <div className="landing-footer-bottom">
            <span>&copy; {new Date().getFullYear()} Livestock Slaughter and Meat Inspection Management System (LSMIS) · Tinaan, City of Naga, Cebu, Philippines.</span>
            <button
              type="button"
              className="back-to-top-btn"
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
