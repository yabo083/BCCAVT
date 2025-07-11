from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response  # 添加 Response
from fastapi.staticfiles import StaticFiles
from celery_app import app as celery_app
from models import CrawlRequest, CrawlResponse, TaskStatusResponse, TaskStatus, TaskResult
import os
import time
import traceback
import uvicorn
from typing import Dict, Any
from urllib.parse import quote

# 创建 FastAPI 应用
app = FastAPI(
    title="B站评论爬虫 API",
    description="基于 FastAPI 和 Celery 的 B站视频评论爬虫服务",
    version="2.0.0"
)

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生产环境中应该设置具体的域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # 明确暴露 Content-Disposition 头
)

# 创建输出目录
output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(output_dir, exist_ok=True)

# 挂载静态文件服务（用于文件下载）
app.mount("/files", StaticFiles(directory=output_dir), name="files")

# 存储任务ID与文件路径的映射
task_file_mapping: Dict[str, str] = {}


@app.get("/")
async def root():
    """根路径，返回 API 信息"""
    return {
        "message": "B站评论爬虫 API",
        "version": "2.0.0",
        "docs": "/docs",
        "status": "running",
        "endpoints": {
            "crawl": "POST /api/crawl",
            "status": "GET /api/status/{task_id}",
            "download": "GET /api/download/{task_id}",
            "health": "GET /api/health"
        }
    }


@app.post("/api/crawl", response_model=CrawlResponse)
async def submit_crawl_task(request: CrawlRequest):
    """
    提交爬取任务
    
    Args:
        request: 包含 BV 号和 Cookie 的请求体
        
    Returns:
        包含任务 ID 的响应
    """
    try:
        # === BV号追踪日志 - FastAPI接收层 ===
        print(f"🔍 [FastAPI] 原始接收的BV号: '{request.bv_id}'")
        print(f"🔍 [FastAPI] BV号类型: {type(request.bv_id)}")
        print(f"🔍 [FastAPI] BV号长度: {len(request.bv_id)}")
        
        # 验证 BV 号格式 - 保持原始大小写，只去除首尾空格
        bv_id = request.bv_id.strip()
        print(f"🔍 [FastAPI] 去除空格后的BV号: '{bv_id}' (保持原始大小写)")
        
        # 转换Cookie对象为字典
        cookie_data = {
            "sessdata": request.cookie.sessdata,
            "bili_jct": request.cookie.bili_jct,
            "buvid3": request.cookie.buvid3,
            "dedeuserid": request.cookie.dedeuserid,
            "ac_time_value": request.cookie.ac_time_value or ""  # 使用 or 而不是 ||
        }
        
        # 打印接收到的 Cookie 数据，验证是否完整
        print(f"Received cookie data: {cookie_data}")
        
        # 设置保存目录
        save_dir = output_dir
        
        # === 添加 Celery 连接和任务提交检查 ===
        print("=== Celery 任务提交检查 ===")
        
        # 1. 检查 Celery 连接
        try:
            inspect = celery_app.control.inspect()
            active_workers = inspect.active()
            registered_tasks = inspect.registered()
            
            print(f"🔍 活跃 Workers: {list(active_workers.keys()) if active_workers else '无'}")
            print(f"🔍 注册的任务: {registered_tasks}")
            
            # 2. 检查任务是否注册
            task_name = 'celery_app.crawl_comments_task'
            task_registered = False
            if registered_tasks:
                for worker, tasks in registered_tasks.items():
                    if task_name in tasks:
                        task_registered = True
                        print(f"✅ 任务 '{task_name}' 已在 Worker '{worker}' 中注册")
                        break
            
            if not task_registered:
                print(f"❌ 任务 '{task_name}' 未注册！")
                print("💡 请检查 Celery Worker 是否正确启动并加载了任务")
                
        except Exception as inspect_error:
            print(f"❌ Celery 连接检查失败: {inspect_error}")
        
        # 3. 提交任务到 Celery
        print(f"📤 提交任务参数:")
        print(f"   - BV号: '{bv_id}' (长度: {len(bv_id)})")
        print(f"   - Cookie数据: {len(cookie_data)} 个字段")
        print(f"   - 保存目录: {save_dir}")
        print(f"🔍 [FastAPI] 即将发送给Celery的BV号: '{bv_id}'")
        
        task = celery_app.send_task(
            'celery_app.crawl_comments_task',
            args=[bv_id, cookie_data, save_dir]
            # 移除 queue 参数，使用默认队列
        )
        
        print(f"✅ 任务已提交: {task.id}")
        print(f"🔍 任务状态: {task.state}")
        
        # 4. 立即检查任务是否被接收
        import time
        time.sleep(0.5)  # 等待0.5秒
        updated_status = task.state
        print(f"🔍 0.5秒后任务状态: {updated_status}")
        
        # 构建状态查询URL
        status_url = f"/api/status/{task.id}"
        
        return CrawlResponse(
            task_id=task.id,
            message="任务已提交，正在处理中...",
            status_url=status_url
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"提交任务时发生错误: {str(e)}"
        )


@app.get("/api/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str, request: Request):
    """
    查询任务状态
    
    Args:
        task_id: 任务 ID
        request: FastAPI请求对象
        
    Returns:
        任务状态和结果
    """
    try:
        # 从 Celery 获取任务结果
        task_result = celery_app.AsyncResult(task_id)
        
        # 安全地获取任务状态
        try:
            status = task_result.state
        except Exception as e:
            print(f"❌ 获取任务状态失败: {str(e)}")
            status = 'UNKNOWN'
        
        try:
            task_info = task_result.info
        except Exception as e:
            print(f"❌ 获取任务信息失败: {str(e)}")
            task_info = None
        
        try:
            task_result_data = task_result.result
        except Exception as e:
            print(f"❌ 获取任务结果失败: {str(e)}")
            task_result_data = None
        
        # 如果所有信息都获取失败，返回安全的错误状态
        if status == 'UNKNOWN' and task_info is None and task_result_data is None:
            return TaskStatusResponse(
                task_id=task_id,
                status="ERROR",
                result=None,
                progress="任务状态查询异常",
                error="无法获取任务状态信息",
                download_url=None
            )
        
        # === 添加详细的任务状态检查 ===
        print(f"=== 查询任务状态: {task_id} ===")
        print(f"🔍 任务状态: {status}")
        print(f"🔍 任务信息: {task_info}")
        print(f"🔍 任务结果: {task_result_data}")
        
        # 检查任务是否在队列中
        try:
            inspect = celery_app.control.inspect()
            active_tasks = inspect.active()
            reserved_tasks = inspect.reserved()
            scheduled_tasks = inspect.scheduled()
            
            print(f"🔍 活跃任务数: {sum(len(tasks) for tasks in active_tasks.values()) if active_tasks else 0}")
            print(f"🔍 保留任务数: {sum(len(tasks) for tasks in reserved_tasks.values()) if reserved_tasks else 0}")
            print(f"🔍 计划任务数: {sum(len(tasks) for tasks in scheduled_tasks.values()) if scheduled_tasks else 0}")
            
            # 检查当前任务是否在这些列表中
            task_found = False
            for task_list_name, task_list in [
                ("活跃", active_tasks), 
                ("保留", reserved_tasks), 
                ("计划", scheduled_tasks)
            ]:
                if task_list:
                    for worker, tasks in task_list.items():
                        for task in tasks:
                            if task.get('id') == task_id:
                                print(f"✅ 任务在 {task_list_name} 列表中，Worker: {worker}")
                                task_found = True
                                break
            
            if not task_found and status == 'PENDING':
                print("❌ 任务状态为 PENDING 但未在任何队列中找到，可能存在路由问题")
                
        except Exception as inspect_error:
            print(f"❌ 任务队列检查失败: {inspect_error}")
        
        # 准备响应数据
        response_data = {
            "task_id": task_id,
            "status": status,
            "result": None,
            "progress": None,
            "error": None,
            "download_url": None
        }
        
        if status == 'PENDING':
            # 任务等待中 - 增加更详细的状态信息
            response_data["progress"] = "等待处理..."
            
            # 检查任务是否长时间停留在PENDING状态
            try:
                # 简单的时间检查逻辑（由于缺少准确的任务提交时间，暂时简化处理）
                response_data["progress"] = "等待处理... (如果长时间无响应，请检查Worker是否正常运行)"
            except Exception:
                pass
            
        elif status == 'STARTED':
            # 任务已开始
            meta = task_info or {}
            response_data["progress"] = meta.get('status', '任务已开始...')
            
        elif status == 'PROGRESS':
            # 任务进行中
            meta = task_info or {}
            response_data["progress"] = meta.get('status', '处理中...')
            
        elif status == 'SUCCESS':
            # 任务成功完成
            result = task_result_data
            try:
                if isinstance(result, dict):
                    # 处理直接的任务结果
                    if 'result' in result:
                        task_result_content = result['result']
                    else:
                        # 如果没有嵌套的result字段，直接使用整个result
                        task_result_content = result
                    
                    # 安全地获取文件路径
                    file_path = task_result_content.get('file_path')
                    download_url = None
                    
                    if file_path and os.path.exists(file_path):
                        # 存储任务ID与文件路径的映射
                        task_file_mapping[task_id] = file_path
                        # 生成下载URL
                        download_url = f"/api/download/{task_id}"
                        # 构建完整的文件URL
                        base_url = f"{request.url.scheme}://{request.url.netloc}"
                        file_url = f"{base_url}{download_url}"
                        task_result_content['file_url'] = file_url
                    
                    # 安全地创建TaskResult对象
                    try:
                        response_data["result"] = TaskResult(**task_result_content)
                    except Exception as model_error:
                        print(f"❌ 创建TaskResult对象失败: {model_error}")
                        # 如果模型创建失败，创建一个基本的结果对象
                        response_data["result"] = TaskResult(
                            file_path=task_result_content.get('file_path'),
                            video_title=task_result_content.get('video_title', '未知标题'),
                            bv_id=task_result_content.get('bv_id'),
                            total_comments=task_result_content.get('total_comments', 0),
                            independent_comments=task_result_content.get('independent_comments', 0)
                        )
                    
                    response_data["progress"] = "100% - 完成"
                    response_data["download_url"] = download_url
                else:
                    # 如果result不是字典，创建基本响应
                    response_data["result"] = None
                    response_data["progress"] = "100% - 完成（结果格式异常）"
                    
            except Exception as success_error:
                print(f"❌ 处理SUCCESS状态时出错: {success_error}")
                response_data["result"] = None
                response_data["progress"] = "100% - 完成（处理结果时出错）"
                response_data["error"] = f"处理成功结果时出错: {str(success_error)}"
                
        elif status == 'FAILURE':
            # 任务失败 - 安全处理异常信息
            error_message = "任务执行失败"
            
            try:
                # 优先从任务结果中获取错误信息
                if task_result_data and isinstance(task_result_data, dict):
                    if 'error' in task_result_data:
                        error_message = task_result_data['error']
                    elif 'message' in task_result_data:
                        error_message = task_result_data['message']
                # 备选：从任务信息中获取错误信息
                elif task_info and isinstance(task_info, dict):
                    error_message = task_info.get('error', error_message)
                    if not error_message or error_message == "":
                        error_message = "任务执行过程中发生未知错误"
                elif task_info and isinstance(task_info, str):
                    error_message = task_info
                # 如果是异常对象，尝试获取异常信息
                elif task_result_data and hasattr(task_result_data, 'args'):
                    error_message = str(task_result_data)
            except Exception as e:
                print(f"❌ 处理错误信息时出错: {str(e)}")
                error_message = "任务执行失败，无法获取详细错误信息"
            
            response_data["error"] = error_message
            response_data["progress"] = "任务失败"
        
        elif status == 'UNKNOWN':
            # 未知状态 - 可能是异常导致的
            response_data["progress"] = "状态未知"
            response_data["error"] = "任务状态异常，可能需要重新提交"
                
        elif status == 'RETRY':
            # 任务重试中
            response_data["progress"] = "重试中..."
            
        else:
            # 其他状态
            response_data["progress"] = f"状态: {status}"
        
        return TaskStatusResponse(**response_data)
        
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"❌ 查询任务状态时发生严重错误:")
        print(f"   - 任务ID: {task_id}")
        print(f"   - 错误: {str(e)}")
        print(f"   - 详细错误信息:\n{error_details}")
        
        # 返回安全的错误响应
        return TaskStatusResponse(
            task_id=task_id,
            status="ERROR",
            result=None,
            progress="查询状态时发生错误",
            error=f"状态查询失败: {str(e)}",
            download_url=None
        )


@app.get("/api/download/{task_id}")
async def download_file(task_id: str):
    """
    下载爬取结果文件
    
    Args:
        task_id: 任务 ID
        
    Returns:
        文件下载响应
    """
    try:
        print(f"=== 下载请求处理 ===")
        print(f"🔍 任务ID: {task_id}")
        print(f"🔍 当前文件映射: {list(task_file_mapping.keys())}")
        
        # 检查任务是否存在文件映射
        if task_id not in task_file_mapping:
            print(f"❌ 任务 {task_id} 不在文件映射中")
            raise HTTPException(
                status_code=404,
                detail="任务文件不存在或任务尚未完成"
            )
        
        file_path = task_file_mapping[task_id]
        print(f"🔍 文件路径: {file_path}")
        
        # 检查文件是否存在
        if not os.path.exists(file_path):
            print(f"❌ 文件不存在: {file_path}")
            raise HTTPException(
                status_code=404,
                detail="文件不存在"
            )
        
        # 获取文件名和大小
        filename = os.path.basename(file_path)
        file_size = os.path.getsize(file_path)
        print(f"🔍 原始文件名: {repr(filename)}")  # 使用 repr 来显示特殊字符
        print(f"🔍 文件大小: {file_size} bytes")
        
        # 安全地处理文件名编码
        try:
            # 确保文件名是有效的UTF-8字符串
            if isinstance(filename, bytes):
                filename = filename.decode('utf-8', errors='replace')
            
            # 对文件名进行URL编码以处理中文字符，但保留基本的安全字符
            encoded_filename = quote(filename, safe='')
            print(f"🔍 编码后文件名: {encoded_filename}")
            
            # 创建一个ASCII安全的备用文件名
            ascii_filename = filename.encode('ascii', errors='ignore').decode('ascii')
            if not ascii_filename:
                ascii_filename = 'comments.json'
            
            print(f"🔍 ASCII安全文件名: {ascii_filename}")
            
            # 构建 Content-Disposition 头，使用更安全的格式
            content_disposition = f'attachment; filename="{ascii_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            print(f"🔍 Content-Disposition: {repr(content_disposition)}")
            
        except Exception as encoding_error:
            print(f"❌ 文件名编码处理失败: {encoding_error}")
            # 使用默认的安全文件名
            filename = "comments.json"
            encoded_filename = "comments.json"
            ascii_filename = "comments.json"
            content_disposition = 'attachment; filename="comments.json"'
            print(f"🔍 使用默认文件名: {filename}")
        
        # 返回文件下载响应
        try:
            response = FileResponse(
                path=file_path,
                filename=ascii_filename,  # 使用ASCII安全的文件名传给FileResponse
                media_type='application/json',
                headers={
                    "Content-Disposition": content_disposition,
                    "Content-Length": str(file_size),
                    "Cache-Control": "no-cache",
                    "Access-Control-Expose-Headers": "Content-Disposition"  # 确保CORS暴露这个头
                }
            )
            
            print(f"✅ 文件响应已创建，准备发送")
            return response
            
        except Exception as response_error:
            print(f"❌ 创建FileResponse失败: {response_error}")
            # 尝试使用最简单的响应方式
            return FileResponse(
                path=file_path,
                filename="comments.json",
                media_type='application/json',
                headers={
                    "Content-Disposition": 'attachment; filename="comments.json"',
                    "Access-Control-Expose-Headers": "Content-Disposition"
                }
            )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 下载文件时发生错误: {str(e)}")
        print(f"❌ 错误详情: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=f"下载文件时发生错误: {str(e)}"
        )


@app.get("/api/tasks")
async def list_active_tasks():
    """
    列出活跃的任务（可选的管理接口）
    
    Returns:
        活跃任务列表
    """
    try:
        # 获取活跃任务
        inspect = celery_app.control.inspect()
        active_tasks = inspect.active()
        
        if active_tasks:
            # 格式化任务信息
            formatted_tasks = []
            for worker, tasks in active_tasks.items():
                for task in tasks:
                    formatted_tasks.append({
                        "task_id": task["id"],
                        "name": task["name"],
                        "worker": worker,
                        "args": task.get("args", []),
                        "kwargs": task.get("kwargs", {})
                    })
            return {"active_tasks": formatted_tasks}
        else:
            return {"active_tasks": []}
            
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"获取任务列表时发生错误: {str(e)}"
        )


@app.delete("/api/tasks/{task_id}")
async def cancel_task(task_id: str):
    """
    取消任务（可选的管理接口）
    
    Args:
        task_id: 要取消的任务 ID
        
    Returns:
        取消结果
    """
    try:
        # 撤销任务
        celery_app.control.revoke(task_id, terminate=True)
        
        return {
            "message": f"任务 {task_id} 已被取消",
            "task_id": task_id
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"取消任务时发生错误: {str(e)}"
        )


@app.get("/api/health")
async def health_check():
    """
    健康检查接口
    
    Returns:
        服务健康状态
    """
    try:
        # 检查 Celery 连接
        inspect = celery_app.control.inspect()
        stats = inspect.stats()
        active_workers = inspect.active()
        registered_tasks = inspect.registered()
        
        celery_status = "healthy" if stats else "unhealthy"
        
        # === 添加详细的健康检查信息 ===
        health_info = {
            "status": "healthy",
            "celery": celery_status,
            "output_dir": output_dir,
            "message": "服务运行正常",
            "celery_details": {
                "workers_count": len(stats) if stats else 0,
                "workers": list(stats.keys()) if stats else [],
                "active_tasks_count": sum(len(tasks) for tasks in active_workers.values()) if active_workers else 0,
                "registered_tasks": registered_tasks,
                "broker_connection": "connected" if stats else "disconnected"
            }
        }
        
        print("=== 健康检查结果 ===")
        print(f"🔍 Celery 状态: {celery_status}")
        print(f"🔍 Workers 数量: {len(stats) if stats else 0}")
        print(f"🔍 活跃任务数: {sum(len(tasks) for tasks in active_workers.values()) if active_workers else 0}")
        print(f"🔍 注册的任务: {registered_tasks}")
        
        return health_info
        
    except Exception as e:
        error_info = {
            "status": "unhealthy",
            "celery": "error",
            "message": f"服务异常: {str(e)}",
            "error_details": str(e)
        }
        
        print(f"❌ 健康检查失败: {str(e)}")
        
        return error_info

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """处理浏览器的 favicon 请求"""
    favicon_path = os.path.join(os.path.dirname(__file__), "static", "favicon.ico")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path)
    else:
        # 返回 204 No Content，告诉浏览器没有 favicon
        return JSONResponse(status_code=204, content=None)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
