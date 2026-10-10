import './globals.css'

export const metadata = {
  title: 'Meu Plano',
  description: 'Proteína, peso e rotina do dia',
  manifest: '/manifest.json',
  icons: { icon: '/icon-192.png', apple: '/apple-icon.png' },
  appleWebApp: { capable: true, title: 'Meu Plano', statusBarStyle: 'default' },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFF5F8',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
