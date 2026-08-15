import { useEffect, useState } from "react";
import { Loader2, ImageOff } from "lucide-react";
import { useConsoleApi } from "@/console/api";

// Loads an image through the authed API (an <img src> can't send a Bearer
// header), turning the response blob into an object URL. Used for the USDT QR
// and payment-proof images.
export const AuthImage = ({ path, alt = "image", className = "", testid }) => {
  const api = useConsoleApi();
  const [url, setUrl] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let objectUrl;
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(path, { responseType: "blob" });
        objectUrl = URL.createObjectURL(data);
        if (alive) { setUrl(objectUrl); setState("ok"); }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);

  if (state === "loading") return <div data-testid={testid && `${testid}-loading`} className={`flex items-center justify-center bg-slate-50 ${className}`}><Loader2 className="h-5 w-5 animate-spin text-sky-500" /></div>;
  if (state === "error") return <div data-testid={testid && `${testid}-error`} className={`flex flex-col items-center justify-center gap-1 bg-slate-50 text-slate-400 ${className}`}><ImageOff className="h-5 w-5" /><span className="text-xs">Unavailable</span></div>;
  return <img data-testid={testid} src={url} alt={alt} className={className} />;
};
