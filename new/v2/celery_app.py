from celery import Celery
import os
import asyncio
from worker_crawler import crawl_bilibili_comments

# Celery 配置
app = Celery('bilibili_crawler')

# 配置 Redis 作为消息队列和结果后端
BROKER_REDIS_URL = os.getenv('BROKER_REDIS_URL', 'redis://192.168.0.106:6379/0')
RESULT_REDIS_URL = os.getenv('REDIS_RESULT_URL', 'redis://192.168.0.106:6379/1')

app.conf.update(
    broker_url=BROKER_REDIS_URL,
    result_backend=RESULT_REDIS_URL,
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='Asia/Shanghai',
    enable_utc=True,
    task_track_started=True,
    # task_routes={
    #     'celery_app.crawl_comments_task': {'queue': 'crawl_queue'},
    # },
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    worker_max_tasks_per_child=50,
)


@app.task(bind=True, name='celery_app.crawl_comments_task')
def crawl_comments_task(self, bv_id, cookie_data, save_dir):
    """
    爬取B站评论的任务
    
    Args:
        self: Celery 任务实例
        bv_id: B站视频BV号
        cookie_data: Cookie数据字典
        save_dir: 保存目录
        
    Returns:
        爬取结果字典
    """
    try:
        # === BV号追踪日志 - Celery任务层 ===
        print(f"🔍 [Celery] 任务接收的参数:")
        print(f"🔍 [Celery] BV号: '{bv_id}' (类型: {type(bv_id)}, 长度: {len(bv_id)})")
        print(f"🔍 [Celery] Cookie数据类型: {type(cookie_data)}")
        print(f"🔍 [Celery] 保存目录: '{save_dir}'")
        
        print(f"开始处理任务: BV号={bv_id}")
        print(f"Cookie数据: {cookie_data}")
        print(f"保存目录: {save_dir}")
        
        # 更新任务状态
        self.update_state(
            state='STARTED',
            meta={'current': 0, 'total': 100, 'status': '开始爬取...'}
        )
        
        # 设置默认保存目录
        if save_dir is None:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            save_dir = os.path.join(current_dir, "output")
        
        # 创建新的事件循环（因为 Celery worker 中可能没有运行的事件循环）
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        # 执行爬取任务
        print(f"🔍 [Celery] 即将传递给爬虫的BV号: '{bv_id}'")
        result = loop.run_until_complete(
            crawl_bilibili_comments(
                bv_id=bv_id,
                cookie_data=cookie_data,
                save_dir=save_dir,
                progress_callback=lambda message: self.update_state(
                    state='PROGRESS',
                    meta={'current': message, 'status': message}
                )
            )
        )
        
        # 检查结果是否包含错误
        if isinstance(result, dict) and 'error' in result:
            # 爬虫返回了错误结果
            error_message = result['error']
            error_type = result.get('error_type', 'CrawlerError')
            
            print(f"爬虫返回错误: {error_message}")
            
            # 不再使用 update_state，直接返回失败结果
            return {
                'status': 'FAILURE',
                'error': error_message,
                'error_type': error_type,
                'message': f'爬取失败: {error_message}'
            }
        
        # 任务完成，返回结果
        return {
            'status': 'SUCCESS',
            'result': result,
            'message': '爬取完成！'
        }
        
    except Exception as exc:
        print(f"任务执行失败: {str(exc)}")
        print(f"异常类型: {type(exc).__name__}")
        
        # 直接返回失败结果，不使用 update_state
        error_message = str(exc)
        error_type = type(exc).__name__
        
        return {
            'status': 'FAILURE',
            'error': error_message,
            'error_type': error_type,
            'message': f'任务执行失败: {error_message}'
        }


@app.task(name='celery_app.test_task')
def test_task():
    """测试任务"""
    return {'message': 'Hello from Celery!'}


if __name__ == '__main__':
    # 启动 Celery worker
    app.start()
