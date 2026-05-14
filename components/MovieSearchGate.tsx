'use client'

import { useMemo, useState, type FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  LocalMovies as LocalMoviesIcon,
  Search as SearchIcon,
  StarBorder as StarBorderIcon,
  Theaters as TheatersIcon,
  TravelExplore as TravelExploreIcon,
} from '@mui/icons-material'

const HOT_KEYWORDS = ['复仇者联盟', '星际穿越', '盗梦空间', '奥本海默', '沙丘'] as const

const FEATURED_MOVIES = [
  { title: '星际档案馆', year: '2024', genre: '科幻 / 悬疑' },
  { title: '暗夜列车', year: '2023', genre: '动作 / 犯罪' },
  { title: '昨日迷城', year: '2025', genre: '剧情 / 冒险' },
] as const

type MovieSearchGateProps = {
  onUnlock: () => void
}

export default function MovieSearchGate({ onUnlock }: MovieSearchGateProps) {
  const [keyword, setKeyword] = useState('')
  const [searchedKeyword, setSearchedKeyword] = useState<string | null>(null)

  const trimmedKeyword = useMemo(() => keyword.trim(), [keyword])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (trimmedKeyword === 'web') {
      onUnlock()
      return
    }

    setSearchedKeyword(trimmedKeyword || '当前关键词')
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #07111f 0%, #0e1b2f 48%, #15243b 100%)',
        color: '#fff',
        py: { xs: 4, md: 8 },
      }}
    >
      <Container maxWidth="lg">
        <Stack spacing={4}>
          <Paper
            elevation={0}
            sx={{
              overflow: 'hidden',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'linear-gradient(135deg, rgba(27, 42, 74, 0.96), rgba(12, 18, 31, 0.98))',
              boxShadow: '0 30px 80px rgba(0, 0, 0, 0.35)',
            }}
          >
            <Box sx={{ p: { xs: 3, md: 6 } }}>
              <Stack spacing={3}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                    }}
                  >
                    <LocalMoviesIcon sx={{ fontSize: 28, color: '#7dd3fc' }} />
                  </Box>
                  <Box>
                    <Typography variant="h4" fontWeight={800}>
                      CineScope 电影搜索
                    </Typography>
                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.72)' }}>
                      探索热门影片、影人信息与上映动态
                    </Typography>
                  </Box>
                </Stack>

                <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '3rem' }, fontWeight: 800, maxWidth: 780 }}>
                  搜索你想看的电影，快速查看影片资料与评分趋势
                </Typography>

                <Typography variant="body1" sx={{ maxWidth: 720, color: 'rgba(255,255,255,0.74)', lineHeight: 1.8 }}>
                  收录全球院线与流媒体热门内容，支持影片名称、导演、演员和关键词模糊检索。
                </Typography>

                <Box component="form" onSubmit={handleSubmit}>
                  <Stack spacing={2}>
                    <TextField
                      fullWidth
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                      placeholder="输入电影名称、演员或关键词"
                      variant="outlined"
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon sx={{ color: 'rgba(255,255,255,0.72)' }} />
                          </InputAdornment>
                        ),
                        sx: {
                          borderRadius: 999,
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          color: '#fff',
                          '& input::placeholder': {
                            color: 'rgba(255,255,255,0.55)',
                            opacity: 1,
                          },
                        },
                      }}
                      sx={{
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: 'rgba(255,255,255,0.14)',
                        },
                        '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
                          borderColor: 'rgba(125, 211, 252, 0.7)',
                        },
                        '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
                          borderColor: '#7dd3fc',
                        },
                      }}
                    />

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                      <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        startIcon={<SearchIcon />}
                        sx={{
                          borderRadius: 999,
                          px: 3,
                          py: 1.3,
                          fontWeight: 700,
                          background: 'linear-gradient(90deg, #2563eb, #0ea5e9)',
                          boxShadow: '0 12px 30px rgba(37, 99, 235, 0.35)',
                        }}
                      >
                        搜索电影
                      </Button>
                      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.58)' }}>
                        热门标签：
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {HOT_KEYWORDS.map((item) => (
                          <Chip
                            key={item}
                            label={item}
                            onClick={() => setKeyword(item)}
                            sx={{
                              color: '#fff',
                              backgroundColor: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.08)',
                            }}
                          />
                        ))}
                      </Stack>
                    </Stack>
                  </Stack>
                </Box>
              </Stack>
            </Box>
          </Paper>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Card sx={{ flex: 1, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff' }}>
              <CardContent>
                <Stack spacing={1.5}>
                  <TheatersIcon sx={{ color: '#93c5fd' }} />
                  <Typography variant="h6" fontWeight={700}>
                    每日热映追踪
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.68)', lineHeight: 1.8 }}>
                    聚合院线与流媒体热度榜单，实时查看最新影片动态。
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff' }}>
              <CardContent>
                <Stack spacing={1.5}>
                  <StarBorderIcon sx={{ color: '#fcd34d' }} />
                  <Typography variant="h6" fontWeight={700}>
                    多维评分展示
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.68)', lineHeight: 1.8 }}>
                    汇总影评人、平台与用户口碑，快速了解影片评价走向。
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff' }}>
              <CardContent>
                <Stack spacing={1.5}>
                  <TravelExploreIcon sx={{ color: '#86efac' }} />
                  <Typography variant="h6" fontWeight={700}>
                    全球片库发现
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.68)', lineHeight: 1.8 }}>
                    输入任意片名或演员名称，尝试发现更多值得关注的新片。
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Stack>

          <Paper
            elevation={0}
            sx={{
              p: { xs: 3, md: 4 },
              borderRadius: 4,
              backgroundColor: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <Stack spacing={2.5}>
              <Typography variant="h5" fontWeight={700}>
                本周编辑推荐
              </Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                {FEATURED_MOVIES.map((movie) => (
                  <Card
                    key={movie.title}
                    sx={{
                      flex: 1,
                      borderRadius: 3,
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
                      color: '#fff',
                    }}
                  >
                    <CardContent>
                      <Stack spacing={1}>
                        <Typography variant="overline" sx={{ color: '#7dd3fc' }}>
                          {movie.year}
                        </Typography>
                        <Typography variant="h6" fontWeight={700}>
                          {movie.title}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.64)' }}>
                          {movie.genre}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Stack>
          </Paper>

          {searchedKeyword !== null && (
            <Alert
              severity="warning"
              sx={{
                borderRadius: 3,
                backgroundColor: 'rgba(23, 33, 58, 0.92)',
                color: '#fff',
                '& .MuiAlert-icon': {
                  color: '#fbbf24',
                },
              }}
            >
              未找到与 “{searchedKeyword}” 相关的电影，请尝试其他关键词。
            </Alert>
          )}
        </Stack>
      </Container>
    </Box>
  )
}
