import { Icon } from "../icons";
import logoImg from "../../assets/logo.png";

export const Loader = () => <div className="loader" />;

export const PageLoader = () => (
  <div className="loader-page">
    <div className="logo" style={{ width: 76, height: 76, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src={logoImg} alt="LSMIS Logo" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.3))" }} />
    </div>
    <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 16 }}>LSMIS</h2>
    <p style={{ color: "#a7f3d0", fontSize: 13 }}>Livestock Slaughter &amp; Meat Inspection System</p>
    <div className="dots"><span /><span /><span /></div>
    <p style={{ color: "rgba(167, 243, 208, 0.7)", fontSize: 11, marginTop: 8 }}>Loading secure session...</p>
  </div>
);
