import { motion } from "framer-motion";

export const Reveal = ({ children, delay = 0, className = "", y = 24 }) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-60px" }}
    transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
  >
    {children}
  </motion.div>
);

// Masked line-by-line kinetic reveal for hero headings
export const MaskedLines = ({ lines, className = "", delay = 0 }) => (
  <div className={className}>
    {lines.map((line, i) => (
      <div key={i} className="overflow-hidden">
        <motion.div
          initial={{ y: "115%" }}
          animate={{ y: 0 }}
          transition={{ duration: 0.9, delay: delay + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
        >
          {line}
        </motion.div>
      </div>
    ))}
  </div>
);
