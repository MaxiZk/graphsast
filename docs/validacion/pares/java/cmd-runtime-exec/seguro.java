import javax.servlet.http.*;

public class PingServlet extends HttpServlet {
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws Exception {
        String host = request.getParameter("host");
        if (!host.matches("^[a-zA-Z0-9.-]+$")) {
            response.sendError(400);
            return;
        }
        Process p = new ProcessBuilder("ping", "-c", "1", host).start();
        p.waitFor();
    }
}
