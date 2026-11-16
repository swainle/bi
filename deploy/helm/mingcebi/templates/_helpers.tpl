{{/* 基础命名与标签 */}}
{{- define "mingcebi.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mingcebi.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "mingcebi.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "mingcebi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "mingcebi.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mingcebi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* 密钥来源：优先已有 Secret，否则用 values 渲染出来的那个 */}}
{{- define "mingcebi.secretName" -}}
{{- if .Values.backend.existingSecret }}
{{- .Values.backend.existingSecret }}
{{- else }}
{{- include "mingcebi.fullname" . }}
{{- end }}
{{- end }}

{{/* 后端通用环境变量（Secret 引用 + 明文配置） */}}
{{- define "mingcebi.backendEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "mingcebi.secretName" . }}
      key: DATABASE_URL
- name: JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "mingcebi.secretName" . }}
      key: JWT_SECRET
- name: LLM_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "mingcebi.secretName" . }}
      key: LLM_API_KEY
      optional: true
- name: ADMIN_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "mingcebi.secretName" . }}
      key: ADMIN_PASSWORD
      optional: true
- name: REDIS_URL
  value: {{ .Values.backend.redisUrl | quote }}
# worker 开启时 API 只入队（worker 容器负责执行）；backend.env 里显式写同名变量可覆盖
- name: BI_JOB_EXECUTOR
  value: {{ ternary "worker" "inline" .Values.worker.enabled | quote }}
{{- range $key, $value := .Values.backend.env }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end }}
