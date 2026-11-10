/**
 * 明策BI — AI智能导入向导（共享组件）
 *
 * 5步流水线：上传 → AI数据处理(LLM) → 交叉校验 → AI深度推断(LLM) → 导入完成
 *
 * Props:
 *   open: boolean — 是否显示
 *   onClose: () => void — 关闭回调
 *   onImportComplete: (result: any) => void — 导入完成回调（用于刷新数据）
 *   importEndpoint: string — 导入API路径（如 '/bi/engine/import/pdd-profit'）
 *   dataMonth?: string — 数据月份
 */

import { useState } from 'react';
import {
  Box, Typography, Button, CircularProgress, Chip, Paper, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stepper, Step, StepLabel, LinearProgress, FormControlLabel, Switch,
} from '@mui/material';
import { Upload as UploadIcon } from '@mui/icons-material';
import client from '../../api/client';

interface ImportWizardProps {
  open: boolean;
  onClose: () => void;
  onImportComplete: (result: any) => void;
  importEndpoint: string;
  dataMonth?: string;
}

export default function ImportWizard({ open, onClose, onImportComplete, importEndpoint, dataMonth }: ImportWizardProps) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wizardStep, setWizardStep] = useState(0);
  const [aiProcessResult, setAiProcessResult] = useState<any>(null);
  const [validateResult, setValidateResult] = useState<any>(null);
  const [aiInferResult, setAiInferResult] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [replaceMode, setReplaceMode] = useState(false);

  const reset = () => {
    setImportFile(null); setImporting(false); setLoading(false);
    setError(''); setWizardStep(0);
    setAiProcessResult(null); setValidateResult(null); setAiInferResult(null); setImportResult(null);
  };

  const handleClose = () => {
    if (!importing && !loading) { reset(); onClose(); }
  };

  // Step 1→2: AI数据处理
  const handleAIProcess = async () => {
    if (!importFile) { setError('请先选择文件'); return; }
    setLoading(true); setError('');
    try {
      const fd = new FormData(); fd.append('file', importFile);
      const r = await client.post(`${importEndpoint}/ai-process`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,  // AI 调用需较长时间
      });
      setAiProcessResult(r.data);
      setWizardStep(1);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'AI处理失败');
    } finally { setLoading(false); }
  };

  // Step 2→3: 交叉校验
  const handleValidate = async () => {
    if (!importFile) { setError('请先选择文件'); return; }
    setLoading(true); setError('');
    try {
      const fd = new FormData(); fd.append('file', importFile);
      const r = await client.post(`${importEndpoint}/cross-validate`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setValidateResult(r.data);
      setWizardStep(3);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '校验失败');
    } finally { setLoading(false); }
  };

  // Step 3→4: AI深度推断
  const handleAIInfer = async () => {
    if (!importFile) { setError('请先选择文件'); return; }
    setLoading(true); setError('');
    try {
      const fd = new FormData(); fd.append('file', importFile);
      const r = await client.post(`${importEndpoint}/ai-infer`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setAiInferResult(r.data);
      setWizardStep(4);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'AI推断失败');
    } finally { setLoading(false); }
  };

  // Step 4→5: 确认导入
  const handleImport = async () => {
    if (!importFile) { setError('请先选择Excel文件'); return; }
    setImporting(true); setError('');
    try {
      const fd = new FormData(); fd.append('file', importFile);
      const r = await client.post(importEndpoint, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params: { data_month: dataMonth || '2026-05', replace_mode: replaceMode },
        timeout: 120000,
      });
      setImportResult(r.data);
      setWizardStep(5);
      onImportComplete(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '导入失败');
    } finally { setImporting(false); }
  };

  const steps = ['上传文件', 'AI数据处理', '交叉校验', 'AI深度推断', '确认导入', '完成'];

  return (
    <Dialog open={open} onClose={handleClose}
      maxWidth={wizardStep >= 3 ? "md" : "sm"} fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}
    >
      <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>
        🤖 AI 智能导入 — DeepSeek
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {wizardStep >= 5 ? '完成' : `第 ${Math.min(wizardStep + 1, 5)} 步`}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <Stepper activeStep={Math.min(wizardStep, 4)} sx={{ mb: 3, '& .MuiStepLabel-label': { fontSize: 11 } }}>
          {steps.slice(0, 5).map((label, i) => (
            <Step key={i} completed={wizardStep > i + 1}><StepLabel>{label}</StepLabel></Step>
          ))}
        </Stepper>

        {/* ═══ Step 5: 导入完成 ═══ */}
        {wizardStep >= 5 ? (
          <Box sx={{ py: 1, maxHeight: 400, overflow: 'auto' }}>
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <Box sx={{ width: 48, height: 48, borderRadius: '50%', mx: 'auto', mb: 1, bgcolor: 'success.main', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20 }}>✓</Box>
              <Typography variant="h6" fontWeight={700} color="success.main">导入完成</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 4, mb: 2 }}>
              <Box sx={{ textAlign: 'center' }}><Typography variant="h5" fontWeight={700} color="primary.main">{importResult?.inserted || 0}</Typography><Typography variant="caption">新增</Typography></Box>
              <Box sx={{ textAlign: 'center' }}><Typography variant="h5" fontWeight={700} color="warning.main">{importResult?.updated || 0}</Typography><Typography variant="caption">更新</Typography></Box>
              <Box sx={{ textAlign: 'center' }}><Typography variant="h5" fontWeight={700}>{importResult?.total || 0}</Typography><Typography variant="caption">总计</Typography></Box>
            </Box>
            {aiInferResult?.ai_inference && (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(99,102,241,0.04)', borderColor: '#C7D2FE' }}>
                <Typography variant="caption" fontWeight={700} color="#6366F1" sx={{ display: 'block', mb: 1 }}>🤖 AI 深度分析</Typography>
                {aiInferResult.ai_inference.business_summary && <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 500 }}>{aiInferResult.ai_inference.business_summary}</Typography>}
                {(aiInferResult.ai_inference.recommendations || []).map((r: string, i: number) => (
                  <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 11 }}>· {r}</Typography>
                ))}
              </Paper>
            )}
          </Box>
        ) : wizardStep === 4 ? (
          /* ═══ Step 4: 确认导入 ═══ */
          <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>
              AI深度推断完成，确认后将数据写入 PostgreSQL 数据库。写入后可在看板中查看。
            </Typography>
            <FormControlLabel
              control={<Switch checked={replaceMode} onChange={e => setReplaceMode(e.target.checked)} size="small" />}
              label={<Typography variant="caption" color={replaceMode ? 'error.main' : 'text.secondary'}>
                {replaceMode ? '⚠ 全量替换：先删除该月份所有数据，再写入新数据' : '增量更新：同店铺覆盖，新店铺追加'}
              </Typography>}
              sx={{ mb: 1 }}
            />
            {aiInferResult && (
              <Alert severity="success" sx={{ mb: 2, fontSize: 13 }}>
                <strong>AI推断完成</strong> — 数据已就绪，点击"确认导入到数据库"写入
              </Alert>
            )}
            {error && <Alert severity="error" sx={{ mt: 1, fontSize: 13 }}>{error}</Alert>}
          </Box>
        ) : wizardStep === 3 ? (
          /* ═══ Step 3: 交叉校验结果 ═══ */
          <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
            {validateResult ? (
              <>
                <Alert severity={validateResult.total_warnings > 5 ? 'warning' : 'success'} sx={{ mb: 2, fontSize: 13 }}>
                  <strong>交叉校验完成</strong> — {validateResult.row_count}行, {validateResult.total_warnings}个异常
                </Alert>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, mb: 1 }}>
                  <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                    <Chip label={`毛利异常 ${validateResult.gross_issues}`} size="small" color={validateResult.gross_issues > 0 ? 'warning' : 'success'} variant="outlined" />
                    <Chip label={`净利异常 ${validateResult.net_issues}`} size="small" color={validateResult.net_issues > 0 ? 'warning' : 'success'} variant="outlined" />
                    <Chip label={`离群值 ${validateResult.outliers}`} size="small" color={validateResult.outliers > 0 ? 'error' : 'default'} variant="outlined" />
                  </Box>
                  {validateResult.warnings?.slice(0, 5).map((w: string, i: number) => (
                    <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 11 }}>· {w.length > 100 ? w.slice(0, 100) + '...' : w}</Typography>
                  ))}
                </Paper>
              </>
            ) : (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>正在执行交叉校验...</Typography>
            )}
            {error && <Alert severity="error" sx={{ mt: 1, fontSize: 13 }}>{error}</Alert>}
          </Box>
        ) : wizardStep === 2 ? (
          /* ═══ Step 2: 交叉校验（加载中，点按钮触发） ═══ */
          <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
              AI数据处理完成。点击「交叉校验 →」执行毛利核对、净利验证、离群值检测。
            </Typography>
            {aiProcessResult && (
              <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
                <strong>AI处理完成</strong> — 清洗 {aiProcessResult.cleaned_count || 0} 处，解析 {aiProcessResult.row_count || 0} 行
              </Alert>
            )}
            {loading && <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />}
            {error && <Alert severity="error" sx={{ mt: 1, fontSize: 13 }}>{error}</Alert>}
          </Box>
        ) : wizardStep === 1 ? (
          /* ═══ Step 1: AI数据处理结果 ═══ */
          <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
            {aiProcessResult ? (
              <>
                <Alert severity="success" sx={{ mb: 2, fontSize: 13 }}>
                  <strong>AI清洗完成</strong> — {aiProcessResult.row_count}行, 清洗{aiProcessResult.cleaned_count}处
                </Alert>
                {aiProcessResult.columns && (
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, mb: 1 }}>
                    <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 1 }}>📋 解析列 ({aiProcessResult.columns.length})</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {aiProcessResult.columns.map((c: string) => (
                        <Chip key={c} label={c} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                      ))}
                    </Box>
                  </Paper>
                )}
                {aiProcessResult.clean_logs?.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 1, borderRadius: 2, bgcolor: '#F5F3FF' }}>
                    <Typography variant="caption" fontWeight={700} color="#8B5CF6" sx={{ display: 'block', mb: 0.5 }}>🧹 清洗日志</Typography>
                    {aiProcessResult.clean_logs.slice(0, 5).map((l: string, i: number) => (
                      <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 10 }}>· {l}</Typography>
                    ))}
                  </Paper>
                )}
              </>
            ) : (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>AI正在处理数据...</Typography>
            )}
            {error && <Alert severity="error" sx={{ mt: 1, fontSize: 13 }}>{error}</Alert>}
          </Box>
        ) : (
          /* ═══ Step 0: 上传文件 ═══ */
          <Box>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2.5 }}>
              上传 .xlsx/.xls 文件，DeepSeek 大模型将智能识别并清洗数据。<br />
              🤖 5步流水线：上传 → AI处理 → 交叉校验 → AI深度推断 → 导入完成
            </Typography>
            <label style={{ display: 'block', cursor: 'pointer' }}>
              <input type="file" hidden accept=".xlsx,.xls,.xlsm"
                onChange={e => { setImportFile(e.target.files?.[0] || null); setError(''); setAiProcessResult(null); setAiInferResult(null); }} />
              <Box sx={{ border: `2px dashed ${importFile ? '#3b5bff' : 'divider'}`, borderRadius: 2, p: 4, textAlign: 'center', bgcolor: importFile ? 'action.hover' : 'transparent', '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}>
                <UploadIcon sx={{ fontSize: 40, color: importFile ? 'primary.main' : 'text.disabled', mb: 1 }} />
                <Typography variant="body2" fontWeight={600}>{importFile ? importFile.name : '点击选择 Excel 文件'}</Typography>
                <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>{importFile ? `${(importFile.size / 1024).toFixed(1)} KB` : '支持 .xlsx .xls .xlsm'}</Typography>
              </Box>
            </label>
            {error && <Alert severity="error" sx={{ mt: 1.5, fontSize: 13 }}>{error}</Alert>}
          </Box>
        )}
        {(loading || importing) && <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 0, gap: 1 }}>
        {wizardStep >= 5 ? (
          <Button onClick={handleClose} variant="contained" sx={{ borderRadius: 1.5, px: 4 }}>完成</Button>
        ) : wizardStep === 4 ? (
          <>
            <Button onClick={() => setWizardStep(3)} disabled={importing} sx={{ textTransform: 'none', borderRadius: 1.5 }}>← 返回</Button>
            <Button onClick={handleImport} variant="contained" disabled={importing}
              startIcon={importing ? <CircularProgress size={14} /> : <UploadIcon />}
              sx={{ borderRadius: 1.5, px: 3, textTransform: 'none' }}>
              {importing ? '导入中...' : '确认导入到数据库'}
            </Button>
          </>
        ) : wizardStep === 3 ? (
          <>
            <Button onClick={() => setWizardStep(2)} disabled={loading} sx={{ textTransform: 'none', borderRadius: 1.5 }}>← 返回</Button>
            <Button onClick={handleAIInfer} variant="contained" disabled={loading}
              startIcon={loading ? <CircularProgress size={14} /> : null}
              sx={{ borderRadius: 1.5, px: 3, textTransform: 'none', bgcolor: '#6366F1' }}>
              {loading ? 'AI分析中...' : 'AI深度推断 →'}
            </Button>
          </>
        ) : wizardStep === 2 ? (
          <>
            <Button onClick={() => setWizardStep(1)} disabled={loading} sx={{ textTransform: 'none', borderRadius: 1.5 }}>← 返回</Button>
            <Button onClick={handleAIInfer} variant="contained" disabled={loading}
              startIcon={loading ? <CircularProgress size={14} /> : null}
              sx={{ borderRadius: 1.5, px: 3, textTransform: 'none', bgcolor: '#6366F1' }}>
              {loading ? 'AI分析中...' : 'AI深度推断 →'}
            </Button>
          </>
        ) : wizardStep === 1 ? (
          <>
            <Button onClick={() => setWizardStep(0)} disabled={loading} sx={{ textTransform: 'none', borderRadius: 1.5 }}>← 返回</Button>
            <Button onClick={handleValidate} variant="contained" disabled={loading}
              startIcon={loading ? <CircularProgress size={14} /> : null}
              sx={{ borderRadius: 1.5, px: 3, textTransform: 'none' }}>
              {loading ? '校验中...' : '交叉校验 →'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleClose} disabled={loading} sx={{ textTransform: 'none', borderRadius: 1.5 }}>取消</Button>
            <Button onClick={handleAIProcess} variant="contained" disabled={!importFile || loading}
              startIcon={loading ? <CircularProgress size={14} /> : null}
              sx={{ borderRadius: 1.5, px: 3, textTransform: 'none', bgcolor: '#6366F1' }}>
              {loading ? 'DeepSeek处理中...' : 'AI数据处理 →'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
