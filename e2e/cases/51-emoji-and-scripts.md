---
# Emoji sequences, flags and right-to-left / joining scripts are legitimate.
event: issue_comment
expect-detected: false
---

Thanks team!

- Family: {U+1F468}{U+200D}{U+1F469}{U+200D}{U+1F467}
- Technologist with skin tone: {U+1F469}{U+1F3FD}{U+200D}{U+1F4BB}
- Heart on fire: {U+2764}{U+FE0F}{U+200D}{U+1F525}
- Rainbow flag: {U+1F3F3}{U+FE0F}{U+200D}{U+1F308}
- Keycaps: 1{U+FE0F}{U+20E3} #{U+FE0F}{U+20E3}
- Scotland: {U+1F3F4}{U+E0067}{U+E0062}{U+E0073}{U+E0063}{U+E0074}{U+E007F}
- Ideographic variation sequence: {U+845B}{U+E0100}

Hebrew with a right-to-left mark: {U+05E9}{U+05DC}{U+05D5}{U+05DD}{U+200F} (v1.2)

Persian with a zero-width non-joiner: {U+0645}{U+06CC}{U+200C}{U+062E}{U+0648}{U+0627}{U+0647}{U+0645}

Devanagari with a zero-width joiner: {U+0915}{U+094D}{U+200D}{U+0937}
