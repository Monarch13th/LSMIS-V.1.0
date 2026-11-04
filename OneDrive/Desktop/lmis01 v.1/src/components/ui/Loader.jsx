import { Icon } from "../icons";
import logoImg from "../../assets/logo.jpg";

export const Loader = () => <div className="loader" />;

export const PageLoader = () => (
  <div className="loader-page">
    <div className="logo" style={{ width: 68, height: 68, borderRadius: "50%", overflow: "hidden", background: "#ffffff", padding: 3, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src={logoImg} alt="LSMIS Logo" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "contain", display: "block" }} />
    </div>
    <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 16 }}>LSMIS</h2>
    <p style={{ color: "#a7f3d0", fontSize: 13 }}>Livestock Slaughter &amp; Meat Inspection System</p>
    <div className="dots"><span /><span /><span /></div>
    <p style={{ color: "rgba(167, 243, 208, 0.7)", fontSize: 11, marginTop: 8 }}>Loading secure session...</p>
  </div>
);
