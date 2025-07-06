from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any, Dict
from enum import Enum


class TaskStatus(str, Enum):
    """任务状态枚举"""
    PENDING = "PENDING"      # 等待中
    STARTED = "STARTED"      # 已开始
    PROGRESS = "PROGRESS"    # 进行中
    SUCCESS = "SUCCESS"      # 成功完成
    FAILURE = "FAILURE"      # 失败
    RETRY = "RETRY"          # 重试中
    REVOKED = "REVOKED"      # 已撤销


class BilibiliCookie(BaseModel):
    """B站Cookie模型"""
    sessdata: str = Field(..., description="B站会话数据")
    bili_jct: str = Field(..., description="B站CSRF令牌")
    buvid3: str = Field(..., description="B站用户标识")
    dedeuserid: str = Field(..., description="B站用户ID")
    ac_time_value: Optional[str] = Field(None, description="B站时间值")
    
    @field_validator('sessdata', 'bili_jct', 'buvid3', 'dedeuserid')
    @classmethod
    def validate_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Cookie字段不能为空')
        return v.strip()
    
    @field_validator('ac_time_value')
    @classmethod
    def validate_ac_time_value(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None
    
    class Config:
        json_schema_extra = {
            "example": {
                "sessdata": "your_sessdata_here",
                "bili_jct": "your_bili_jct_here",
                "buvid3": "your_buvid3_here",
                "dedeuserid": "your_dedeuserid_here",
                "ac_time_value": "your_ac_time_value_here"
            }
        }


class CrawlRequest(BaseModel):
    """爬取请求模型"""
    bv_id: str = Field(..., description="B站视频BV号", min_length=12, max_length=12)
    cookie: BilibiliCookie = Field(..., description="B站Cookie信息")  # 添加这行
    
    @field_validator('bv_id')
    @classmethod
    def validate_bv_id(cls, v):
        if not v.startswith('BV'):
            raise ValueError('BV号必须以"BV"开头')
        if len(v) != 12:
            raise ValueError('BV号长度必须为12位')
        return v

    
    class Config:
        json_schema_extra = {
            "example": {
                "bv_id": "BV1AYKgzAE68",
                "cookie": {
                    "sessdata": "your_sessdata_here",
                    "bili_jct": "your_bili_jct_here",
                    "buvid3": "your_buvid3_here",
                    "dedeuserid": "your_dedeuserid_here",
                    "ac_time_value": "your_ac_time_value_here"
                }
            }
        }


class CrawlResponse(BaseModel):
    """爬取响应模型"""
    task_id: str
    message: str
    status_url: str = Field(..., description="查询任务状态的URL")
    
    class Config:
        json_schema_extra = {
            "example": {
                "task_id": "550e8400-e29b-41d4-a716-446655440000",
                "message": "任务已提交，正在处理中...",
                "status_url": "/api/status/550e8400-e29b-41d4-a716-446655440000"
            }
        }


class TaskResult(BaseModel):
    """任务结果模型"""
    file_path: Optional[str] = None
    file_url: Optional[str] = None
    video_title: Optional[str] = None
    bv_id: Optional[str] = None
    total_comments: Optional[int] = None
    independent_comments: Optional[int] = None
    most_active_user: Optional[str] = None
    most_active_count: Optional[int] = None
    max_likes: Optional[int] = None
    max_likes_comment: Optional[str] = None


class TaskStatusResponse(BaseModel):
    """任务状态响应模型"""
    task_id: str
    status: TaskStatus
    result: Optional[TaskResult] = None
    progress: Optional[str] = None
    error: Optional[str] = None
    download_url: Optional[str] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "task_id": "550e8400-e29b-41d4-a716-446655440000",
                "status": "SUCCESS",
                "result": {
                    "file_path": "/path/to/comments.json",
                    "file_url": "/api/download/550e8400-e29b-41d4-a716-446655440000",
                    "video_title": "视频标题",
                    "total_comments": 156,
                    "independent_comments": 45
                },
                "progress": "100%",
                "error": None,
                "download_url": "/api/download/550e8400-e29b-41d4-a716-446655440000"
            }
        }
