import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function GET() {
  try {
    // 检查 FFmpeg 是否安装
    const { stdout: versionOutput } = await execAsync('ffmpeg -version')
    
    // 解析版本信息
    const versionMatch = versionOutput.match(/ffmpeg version (\S+)/)
    const version = versionMatch ? versionMatch[1] : 'unknown'
    
    // 检查支持的编码器（Windows 和 Unix 兼容写法）
    let encodersOutput = ''
    try {
      const result = await execAsync('ffmpeg -encoders')
      encodersOutput = result.stdout + result.stderr
    } catch (e: any) {
      // ffmpeg -encoders 可能返回非零退出码但仍有输出
      encodersOutput = e.stdout || e.stderr || ''
    }
    
    const hasH264 = encodersOutput.includes('libx264')
    const hasAAC = encodersOutput.includes('aac')
    const hasVP9 = encodersOutput.includes('libvpx-vp9')
    const hasOpus = encodersOutput.includes('libopus')
    
    return NextResponse.json({
      installed: true,
      version,
      encoders: {
        h264: hasH264,
        aac: hasAAC,
        vp9: hasVP9,
        opus: hasOpus,
      },
      mp4Support: hasH264 || hasAAC, // 有任一编码器就可能支持
      webmSupport: hasVP9 || hasOpus,
      message: 'FFmpeg 已安装并可用',
    })
    
  } catch (error: any) {
    // 提供更详细的错误信息
    const errorDetail = error.message || String(error)
    const isPathIssue = errorDetail.includes('not recognized') || 
                        errorDetail.includes('not found') ||
                        errorDetail.includes('ENOENT')
    
    return NextResponse.json({
      installed: false,
      version: null,
      encoders: null,
      mp4Support: false,
      webmSupport: false,
      message: isPathIssue 
        ? 'FFmpeg 未安装或不在 PATH 中。如果刚安装，请重启开发服务器。'
        : `FFmpeg 检测失败: ${errorDetail}`,
      error: errorDetail,
      hint: '如果刚安装 FFmpeg，请重启 Next.js 开发服务器 (npm run dev)',
    })
  }
}
