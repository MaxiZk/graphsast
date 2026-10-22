import javax.servlet.http.*;

public class PingServlet extends HttpServlet {
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws Exception {
        String host = request.getParameter("host");
        Process p = Runtime.getRuntime().exec("ping -c 1 " + host);
        p.waitFor();
    }
}
