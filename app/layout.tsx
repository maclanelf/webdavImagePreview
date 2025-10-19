import type { Metadata } from 'next'
import ThemeRegistry from './ThemeRegistry'

export const metadata: Metadata = {
  title: 'WebDAV 媒体预览器',
  description: '通过WebDAV连接查看和预览图片、视频',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <ThemeRegistry>
          {children}
        </ThemeRegistry>
      </body>
    </html>
  )
}

