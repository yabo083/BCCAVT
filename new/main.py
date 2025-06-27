from module_crawler import crawl_comments
from module_processor import read_csv
import os
import argparse
import sys
import logging

def setup_logging():
    """配置日志系统"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler()]
    )
    return logging.getLogger(__name__)

def validate_bv_id(bv_id):
    """验证BV号格式"""
    if not bv_id.startswith("BV") or len(bv_id) < 10:
        return False
    return True

def parse_arguments():
    """处理命令行参数"""
    parser = argparse.ArgumentParser(description='B站评论爬取与分析工具')
    parser.add_argument('-b', '--bv', help='B站BV号')
    parser.add_argument('-o', '--output', help='输出目录')
    parser.add_argument('--skip-analysis', action='store_true', help='仅爬取评论，不进行分析')
    return parser.parse_args()

def main():
    """主函数"""
    logger = setup_logging()
    
    # 处理命令行参数
    args = parse_arguments()
    
    # 获取BV号
    bv_id = args.bv
    if not bv_id:
        bv_id = input("请输入B站BV号：").strip()
    
    # 验证BV号
    if not validate_bv_id(bv_id):
        logger.error(f"无效的BV号: {bv_id}")
        return 1
    
    # 设置输出目录
    save_dir = args.output or os.path.join(os.path.dirname(os.path.abspath(__file__)), "bilibili_csv_output")
    os.makedirs(save_dir, exist_ok=True)
    
    try:
        # 爬取评论并保存为CSV
        logger.info(f"开始爬取视频 {bv_id} 的评论...")
        csv_path = crawl_comments(bv_id, save_dir)
        logger.info(f"评论已保存到: {csv_path}")
        
        # 处理CSV，生成JSON并输出统计
        if not args.skip_analysis:
            logger.info("开始分析评论...")
            read_csv(csv_path)
            logger.info("评论分析完成")
        
        return 0
    except Exception as e:
        logger.error(f"程序运行出错: {str(e)}")
        return 1

if __name__ == '__main__':
    sys.exit(main())