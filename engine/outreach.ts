/**
 * The letter a merchant receives. It takes only the merchant's identity, on purpose: if it cannot see the evidence it
 * cannot leak it. RBI's KYC Direction keeps the reasons for a risk view confidential (no tipping off), so the letter
 * is word-for-word the same whatever fired, including nothing.
 */
export function merchantLetter(m: { id: string; name: string; category: string }): string {
  return [
    `Subject: Periodic merchant profile update (${m.name} | MID ${m.id})`,
    '',
    `Dear ${m.name} team,`,
    '',
    `We periodically confirm that the details we hold for your ${m.category} account are current. Please share the following within 7 days:`,
    '• Your current products or services, with a menu, catalogue or price list',
    '• Trading hours and the areas you serve, including any delivery',
    '• A list of the QR codes, payment links and terminals you use, and what each is for',
    '• A few recent sales invoices and supplier bills',
    '• Anything new since you signed up (outlet, product, hours, online sales, event), the date it began and a document for it',
    '',
    'If something has changed, we will record it on your profile as a Context Passport once it has been checked.',
    'If you need more time or disagree with a decision on your account, reply to this message and a person will review it.',
    '',
    'Regards,',
    'Merchant Support',
  ].join('\n');
}
